/**
 * Gamification engine tests — the pure derivation layer.
 *
 * Everything here runs on plain event arrays with a fixed clock: no React,
 * no IndexedDB. The store and UI layers wrap these same functions, so getting
 * the rules right here covers the whole reward system.
 */

import { describe, expect, it } from 'vitest';
import type { XpEvent } from '../src/db/schema';
import {
  BADGES,
  comboBonusXp,
  deriveGamification,
  levelForXp,
  localDayKey,
  MAX_LEVEL,
  pendingQuestBonuses,
  pickDailyQuests,
  planCardRead,
  planLessonComplete,
  planQuizAnswer,
  type PlannedAward,
  QUEST_POOL,
  starsForScore,
  streakBonusXp,
  XP_RULES,
  xpToReachLevel,
  BADGE_IDS,
} from '../src/gamification/engine';

let idCounter = 0;

function makeEvent(partial: Partial<XpEvent> & Pick<XpEvent, 'kind' | 'created_at'>): XpEvent {
  idCounter += 1;
  return {
    id: `evt-${idCounter}`,
    student_id: 'stu-1',
    xp: 0,
    ...partial,
  };
}

function quizCorrect(ts: number, question = 'q'): XpEvent {
  return makeEvent({ kind: 'quiz_correct', created_at: ts, lesson_id: 'l', question_id: question, xp: 10 });
}

function quizWrong(ts: number): XpEvent {
  return makeEvent({ kind: 'quiz_wrong', created_at: ts, lesson_id: 'l', question_id: 'q', xp: 2 });
}

function lessonDone(ts: number, lessonId: string, score: number, xp = 25): XpEvent {
  return makeEvent({ kind: 'lesson_completed', created_at: ts, lesson_id: lessonId, score, xp });
}

/** Local noon timestamp for (y, m, d) — independent of parser timezones. */
function dayTs(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

describe('XP rules', () => {
  it('combo bonus grows per consecutive correct answer and caps', () => {
    expect(comboBonusXp(1)).toBe(0);
    expect(comboBonusXp(2)).toBe(5);
    expect(comboBonusXp(3)).toBe(10);
    expect(comboBonusXp(4)).toBe(15);
    expect(comboBonusXp(5)).toBe(20);
    expect(comboBonusXp(6)).toBe(25);
    expect(comboBonusXp(50)).toBe(XP_RULES.comboMaxBonus);
  });

  it('streak day bonus scales and caps', () => {
    expect(streakBonusXp(0)).toBe(0);
    expect(streakBonusXp(1)).toBe(5);
    expect(streakBonusXp(10)).toBe(50);
    expect(streakBonusXp(99)).toBe(XP_RULES.streakBonusMax);
  });
});

describe('levels', () => {
  it('level 1 costs 0 XP, threshold at 100', () => {
    expect(xpToReachLevel(1)).toBe(0);
    expect(xpToReachLevel(2)).toBe(100);
    expect(xpToReachLevel(3)).toBe(300);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
  });

  it('caps at MAX_LEVEL without overflowing', () => {
    const huge = xpToReachLevel(MAX_LEVEL) * 1000;
    expect(levelForXp(huge)).toBe(MAX_LEVEL);
  });

  it('state exposes level progress deltas', () => {
    const state = deriveGamification(
      [
        makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 1), xp: 100 }),
      ],
      dayTs(2026, 1, 1),
    );
    expect(state.level).toBe(2);
    expect(state.xpIntoLevel).toBe(0);
    expect(state.xpToNextLevel).toBe(200);
    expect(state.levelTitleKey).toMatch(/^level\./);
  });
});

describe('stars', () => {
  it('maps scores to 1-3 stars', () => {
    expect(starsForScore(1)).toBe(3);
    expect(starsForScore(1 - 0.000001)).toBe(3);
    expect(starsForScore(0.7)).toBe(2);
    expect(starsForScore(0.66)).toBe(2);
    expect(starsForScore(0.4)).toBe(1);
    expect(starsForScore(0)).toBe(1);
  });

  it('keeps the best stars per lesson across replays', () => {
    const events = [
      lessonDone(dayTs(2026, 1, 1), 'l1', 0.4, 25),
      lessonDone(dayTs(2026, 1, 2), 'l1', 1, 0),
    ];
    const state = deriveGamification(events, dayTs(2026, 1, 2));
    expect(state.starsByLesson.l1).toBe(3);
    expect(state.totalStars).toBe(3);
    expect(state.completedLessons).toEqual(['l1']);
  });
});

describe('streaks', () => {
  it('empty history has no streak', () => {
    const state = deriveGamification([], dayTs(2026, 1, 10));
    expect(state.streak).toEqual({ current: 0, longest: 0, activeToday: false });
  });

  it('counts consecutive days and resets on a gap', () => {
    const events = [
      makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 1), xp: 10 }),
      makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 2), xp: 10 }),
      makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 3), xp: 10 }),
      makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 6), xp: 10 }),
    ];
    const state = deriveGamification(events, dayTs(2026, 1, 6));
    expect(state.streak.longest).toBe(3);
    expect(state.streak.current).toBe(1);
    expect(state.streak.activeToday).toBe(true);
  });

  it('a yesterday streak stays alive until today midnight', () => {
    const events = [makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 5), xp: 10 })];
    const state = deriveGamification(events, dayTs(2026, 1, 6, 8));
    expect(state.streak.activeToday).toBe(false);
    expect(state.streak.current).toBe(1);
  });

  it('a cold day has no current streak even if today is active', () => {
    const events = [makeEvent({ kind: 'quiz_correct', created_at: dayTs(2026, 1, 9), xp: 10 })];
    const state = deriveGamification(events, dayTs(2026, 1, 9));
    expect(state.streak.current).toBe(1);
    expect(state.streak.longest).toBe(1);
  });
});

describe('combo', () => {
  it('consecutive corrects build a combo; a wrong answer resets it', () => {
    const events = [
      quizCorrect(dayTs(2026, 1, 1, 9)),
      quizCorrect(dayTs(2026, 1, 1, 10)),
      quizWrong(dayTs(2026, 1, 1, 11)),
      quizCorrect(dayTs(2026, 1, 1, 12)),
      quizCorrect(dayTs(2026, 1, 1, 13)),
    ];
    const state = deriveGamification(events, dayTs(2026, 1, 1, 14));
    expect(state.currentCombo).toBe(2);
    expect(state.maxCombo).toBe(2);
  });

  it('combo continues across lessons and days', () => {
    const events = [
      quizCorrect(dayTs(2026, 1, 1, 9)),
      quizCorrect(dayTs(2026, 1, 1, 10)),
    ];
    const state = deriveGamification(events, dayTs(2026, 1, 1, 10));
    expect(state.currentCombo).toBe(2);
  });
});

describe('badges', () => {
  const now = dayTs(2026, 1, 1, 9);

  it('defines a unique, i18n-keyed set', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BADGE_IDS).toEqual(ids);
    for (const badge of BADGES) {
      expect(badge.nameKey).toMatch(/^badge\.[a-z_0-9]+\.name$/);
      expect(badge.descKey).toMatch(/^badge\.[a-z_0-9]+\.desc$/);
      expect(badge.icon.trim().length).toBeGreaterThan(0);
    }
  });

  function stateWithCorrect(n: number) {
    const events: XpEvent[] = [];
    for (let i = 0; i < n; i++) events.push(quizCorrect(now, `q${i}`));
    return deriveGamification(events, now);
  }

  it('quiz_novice at 10, quiz_master at 50 correct answers', () => {
    expect(stateWithCorrect(9).badges).not.toContain('quiz_novice');
    expect(stateWithCorrect(10).badges).toContain('quiz_novice');
    expect(stateWithCorrect(49).badges).not.toContain('quiz_master');
    expect(stateWithCorrect(50).badges).toContain('quiz_master');
  });

  it('first_step and scholar track completions', () => {
    const events = [lessonDone(now, 'l1', 0.7)];
    expect(deriveGamification(events, now).badges).toContain('first_step');
    const many: XpEvent[] = [];
    for (let i = 0; i < 15; i++) many.push(lessonDone(dayTs(2026, 1, Math.min(i + 1, 15)), `l${i}`, 0.7));
    expect(deriveGamification(many, dayTs(2026, 1, 15)).badges).toContain('scholar');
  });

  it('perfect badges award only the first perfect run per lesson', () => {
    const events = [
      lessonDone(now, 'l1', 1),
      lessonDone(now + 60_000, 'l1', 1),
      lessonDone(now + 120_000, 'l2', 1),
    ];
    const state = deriveGamification(events, now + 120_000);
    expect(state.perfectCount).toBe(2);
    expect(state.badges).toContain('perfect');
    expect(state.badges).not.toContain('perfect_five');
  });

  it('streak badges use longest streak', () => {
    const events = [quizCorrect(dayTs(2026, 1, 1)), quizCorrect(dayTs(2026, 1, 2)), quizCorrect(dayTs(2026, 1, 3))];
    const state = deriveGamification(events, dayTs(2026, 1, 3));
    expect(state.badges).toContain('streak_3');
    expect(state.badges).not.toContain('streak_7');
  });

  it('combo_5 badges a five-run', () => {
    const events: XpEvent[] = [];
    for (let i = 0; i < 5; i++) events.push(quizCorrect(now, `q${i}`));
    expect(deriveGamification(events, now).badges).toContain('combo_5');
  });

  it('comeback triggers after a 7+ day gap', () => {
    const events = [
      quizCorrect(dayTs(2026, 1, 1)),
      quizCorrect(dayTs(2026, 1, 9)),
    ];
    expect(deriveGamification(events, dayTs(2026, 1, 9)).badges).toContain('comeback');
  });

  it('early_bird needs a correct answer in the 5-8am window', () => {
    const events = [quizCorrect(dayTs(2026, 1, 4, 6))];
    expect(deriveGamification(events, dayTs(2026, 1, 4, 6)).badges).toContain('early_bird');
    expect(stateWithCorrect(3).badges).not.toContain('early_bird');
  });
});

describe('daily quests', () => {
  it('picks three stable quests per day, rotating daily', () => {
    const monday = pickDailyQuests('2026-1-5');
    const sameDay = pickDailyQuests('2026-1-5');
    const tuesday = pickDailyQuests('2026-1-6');
    expect(monday.map((q) => q.id)).toEqual(sameDay.map((q) => q.id));
    expect(monday.length).toBe(3);
    expect(tuesday.length).toBe(3);
  });

  it('reports live progress against today only', () => {
    const now = dayTs(2026, 1, 6, 15);
    const events = [
      lessonDone(dayTs(2026, 1, 5), 'l1', 0.5), // yesterday — must not count
      lessonDone(now, 'l2', 0.9),
    ];
    const state = deriveGamification(events, now);
    // Quest progress is always relative to the events of `now`'s local day.
    const lessonDef = QUEST_POOL.find((q) => q.id === 'q_lesson')!;
    expect(lessonDef.progress(events, now)).toBe(1); // only today's lesson counts
    expect(lessonDef.progress(events, dayTs(2026, 1, 5, 15))).toBe(1); // only the other day's lesson counts
    for (const quest of state.quests) {
      const def = QUEST_POOL.find((q) => q.id === quest.id)!;
      expect(quest.progress).toBe(Math.min(def.progress(events, now), quest.target));
      expect(quest.done).toBe(quest.progress >= quest.target);
    }
  });

  it('grants a quest bonus on the day the quest completes, once only', () => {
    const now = dayTs(2026, 1, 7, 15);
    const base = [lessonDone(now, 'l2', 0.9)];
    // The store has already granted today's bonuses for every satisfied quest.
    const events = [
      ...base,
      ...pickDailyQuests(localDayKey(now))
        .filter((def) => def.progress(base, now) >= def.target)
        .map((def) => makeEvent({ kind: 'quest_bonus', created_at: now, quest_id: def.id, xp: def.reward })),
    ];
    expect(pendingQuestBonuses(events, now)).toEqual([]);
  });

  it('a satisfied quest with no bonus yet is ready to grant, and is not re-granted after', () => {
    const now = dayTs(2026, 1, 8, 15);
    const events = [lessonDone(now, 'l2', 0.9)];
    const satisfiedUngranted = pickDailyQuests(localDayKey(now)).filter(
      (def) =>
        def.progress(events, now) >= def.target &&
        !events.some((e) => e.kind === 'quest_bonus' && e.quest_id === def.id),
    );
    const pending = pendingQuestBonuses(events, now);
    expect(pending.map((q) => q.id)).toEqual(satisfiedUngranted.map((q) => q.id));

    // Grant every pending bonus, then nothing may be pending again.
    const granted = [
      ...events,
      ...pending.map((q) => makeEvent({ kind: 'quest_bonus', created_at: now, quest_id: q.id, xp: q.reward })),
    ];
    expect(pendingQuestBonuses(granted, now)).toEqual([]);
  });

  it('rotation covers the whole pool over a month', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 31; day++) {
      pickDailyQuests(`2026-1-${day}`).forEach((q) => seen.add(q.id));
    }
    expect(seen.size).toBe(QUEST_POOL.length);
  });
});

describe('award planning', () => {
  const now = dayTs(2026, 1, 5, 10);

  function asEvents(planned: PlannedAward[]): XpEvent[] {
    return planned.map((p, i) => ({
      id: `test-${i}`,
      student_id: 'stu-1',
      ...p,
    }));
  }

  it('card read dedupes by lesson+card', () => {
    const first = planCardRead([], 'l1', 'c1', now);
    expect(first).toHaveLength(2); // daily_first + card_read
    expect(first[1]).toMatchObject({ kind: 'card_read', xp: 1 });
    const again = planCardRead(asEvents(first), 'l1', 'c1', now + 60_000);
    expect(again).toHaveLength(0);
  });

  it('quiz correct pays combo bonus on the second consecutive answer', () => {
    const first = planQuizAnswer([], 'l1', 'q1', true, now);
    expect(first[first.length - 1]!.xp).toBe(XP_RULES.quizCorrect);
    const second = planQuizAnswer(asEvents(first), 'l1', 'q2', true, now + 60_000);
    expect(second[second.length - 1]!.xp).toBe(XP_RULES.quizCorrect + comboBonusXp(2));
  });

  it('wrong answers give effort points and reset the combo', () => {
    const events = asEvents([quizCorrect(now)]);
    const plan = planQuizAnswer(events, 'l1', 'q2', false, now + 60_000);
    expect(plan[plan.length - 1]!.kind).toBe('quiz_wrong');
    expect(plan[plan.length - 1]!.xp).toBe(XP_RULES.quizAttempt);
  });

  it('first lesson completion pays full XP plus perfect bonus', () => {
    const plan = planLessonComplete([], 'l1', 1, now);
    const kinds = plan.map((e) => e.kind);
    expect(kinds).toContain('lesson_completed');
    expect(kinds).toContain('perfect_bonus');
    expect(plan.find((e) => e.kind === 'lesson_completed')!.xp).toBe(XP_RULES.lessonCompleted);
    expect(plan.find((e) => e.kind === 'perfect_bonus')!.xp).toBe(XP_RULES.perfectBonus);
  });

  it('a replay that beats the star record pays the small improvement bonus', () => {
    const events = asEvents([lessonDone(now, 'l1', 0.5)]);
    const plan = planLessonComplete(events, 'l1', 1, now + 60_000);
    const completed = plan.find((e) => e.kind === 'lesson_completed')!;
    expect(completed.xp).toBe(XP_RULES.lessonReplayImproved);
    expect(plan.some((e) => e.kind === 'perfect_bonus')).toBe(true);
  });

  it('a flat replay pays zero XP and no perfect bonus twice', () => {
    const events = asEvents([lessonDone(now, 'l1', 0.5), lessonDone(now + 60_000, 'l1', 0.7)]);
    const plan = planLessonComplete(events, 'l1', 0.7, now + 120_000);
    const completed = plan.find((e) => e.kind === 'lesson_completed')!;
    expect(completed.xp).toBe(0);
    expect(plan.some((e) => e.kind === 'perfect_bonus')).toBe(false);
  });

  it('day opening pays daily + streak bonus exactly once per day', () => {
    const before = asEvents([quizCorrect(dayTs(2026, 1, 4, 9))]);
    const plan = planQuizAnswer(before, 'l1', 'q2', true, now);
    const kinds = plan.map((e) => e.kind);
    expect(kinds).toContain('daily_first');
    expect(kinds).toContain('streak_bonus');
    const second = planQuizAnswer([...before, ...asEvents(plan)], 'l1', 'q3', true, now + 60_000);
    expect(second.map((e) => e.kind)).not.toContain('daily_first');
    expect(second.map((e) => e.kind)).not.toContain('streak_bonus');
  });
});

describe('scalar rollups', () => {
  it('tracks today/week XP and accuracy from totals of the whole log', () => {
    const now = dayTs(2026, 1, 10, 12);
    const events = [
      quizCorrect(dayTs(2026, 1, 3, 9)), // this week, not today
      quizCorrect(dayTs(2026, 1, 10, 9)), // today
      quizWrong(dayTs(2026, 1, 10, 10)), // today
      lessonDone(dayTs(2026, 1, 10, 11), 'l1', 0.5),
    ];
    const state = deriveGamification(events, now);
    expect(state.todayXp).toBeGreaterThan(0);
    expect(state.weekXp).toBeGreaterThanOrEqual(state.todayXp);
    expect(state.xp).toBeGreaterThanOrEqual(state.weekXp);
    expect(state.answered).toBe(3);
    expect(state.accuracy).toBeCloseTo(2 / 3);
  });
});