/**
 * Gamification engine — pure derivation over append-only XP events.
 *
 * Design rules (mirrors the xAPI/CRDT doctrine elsewhere in the app):
 *  - Every reward is an immutable `XpEvent` row. History is never rewritten,
 *    so totals stay correct no matter how the rules evolve later: old events
 *    keep the XP they had when they were earned.
 *  - Everything the UI shows (level, streak, stars, badges, quests) is a
 *    DERIVED function of the event log — deterministic, offline, and trivial
 *    to unit-test without React, IndexedDB, or a clock other than `now`.
 *  - Award amounts are decided at write time by the `plan*` functions below,
 *    which the store wraps in real events. Planning is pure too.
 *
 * No imports outside `../db/schema` types: this file must run anywhere.
 */

import type { XpEvent } from '../db/schema';

// ---------------------------------------------------------------------------
// XP rules
// ---------------------------------------------------------------------------

export const XP_RULES = {
  /** Reading a card (each unique lesson+card counts once). */
  cardRead: 1,
  /** Correct quiz answer (before combo bonus). */
  quizCorrect: 10,
  /** Consolation for attempting a wrong answer — effort always counts. */
  quizAttempt: 2,
  /** First completion of a lesson. */
  lessonCompleted: 25,
  /** Replay that earns more stars than the best attempt so far. */
  lessonReplayImproved: 10,
  /** First perfect (100%) score on a lesson. */
  perfectBonus: 25,
  /** First learning activity of a calendar day. */
  dailyFirst: 20,
  /** Streak day bonus = streakDays * 5, capped here. */
  streakBonusMax: 50,
  /** Combo bonus grows by `comboStep` per consecutive correct, capped. */
  comboStep: 5,
  comboMaxBonus: 25,
} as const;

/** XP bonus for an N-length run of consecutive correct answers. */
export function comboBonusXp(comboAfterCorrect: number): number {
  if (comboAfterCorrect <= 1) return 0;
  return Math.min((comboAfterCorrect - 1) * XP_RULES.comboStep, XP_RULES.comboMaxBonus);
}

/** Day bonus for a streak of `streakDays` (1 = first consecutive day). */
export function streakBonusXp(streakDays: number): number {
  if (streakDays <= 0) return 0;
  return Math.min(streakDays * 5, XP_RULES.streakBonusMax);
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 50;

/** Cumulative XP required to REACH `level` (level 1 costs 0). */
export function xpToReachLevel(level: number): number {
  if (level <= 1) return 0;
  const capped = Math.min(level, MAX_LEVEL + 1);
  return 100 * ((capped - 1) * capped) / 2;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xpToReachLevel(level + 1) <= xp) level++;
  return level;
}

/** i18n key for the celebratory title shown next to a level. */
export function levelTitleKey(level: number): string {
  if (level >= 25) return 'level.legend';
  if (level >= 17) return 'level.master';
  if (level >= 12) return 'level.genius';
  if (level >= 8) return 'level.solver';
  if (level >= 5) return 'level.brainy';
  if (level >= 3) return 'level.learner';
  return 'level.explorer';
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** Stars awarded for a completion score (0..1). Finishing always earns ≥1. */
export function starsForScore(score: number): number {
  if (score >= 0.999) return 3;
  if (score >= 0.66) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Local calendar days (a school day is a LOCAL day, not a UTC day)
// ---------------------------------------------------------------------------

export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function isSameLocalDay(a: number, b: number): boolean {
  return localDayKey(a) === localDayKey(b);
}

function dayStartTs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

const INVALID_DAY = '__invalid__';

function previousDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  // An invalid key is self-identical under subtraction, which could loop the
  // streak walk — make it a sentinel that matches no real day.
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return INVALID_DAY;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function sortedUniqueDayKeys(events: XpEvent[]): string[] {
  // Non-finite timestamps are skipped: an event with an invalid `created_at`
  // must degrade to "no activity", never loop (NaN date keys are identical
  // under `previousDayKey`).
  const keys = new Set(
    events
      .filter((event) => Number.isFinite(event.created_at))
      .map((event) => localDayKey(event.created_at)),
  );
  return [...keys].sort((a, b) => dayStartTs(a) - dayStartTs(b));
}

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

export interface StreakInfo {
  /** Consecutive active days ending today (or yesterday when today is empty). */
  current: number;
  longest: number;
  activeToday: boolean;
}

export interface QuestState {
  id: string;
  icon: string;
  titleKey: string;
  target: number;
  reward: number;
  progress: number;
  done: boolean;
}

export interface GamificationState {
  xp: number;
  level: number;
  levelTitleKey: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpToNextLevel: number;

  correct: number;
  wrong: number;
  answered: number;
  /** 0..1; 0 when nothing answered yet. */
  accuracy: number;

  lessonsCompleted: number;
  completedLessons: string[];
  perfectCount: number;
  perfectLessons: string[];
  cardsRead: number;
  readCards: ReadonlySet<string>;

  /** Consecutive correct answers ending at the most recent quiz event. */
  currentCombo: number;
  maxCombo: number;

  streak: StreakInfo;
  starsByLesson: Record<string, number>;
  totalStars: number;

  /** Earned badge ids (see BADGES). */
  badges: string[];
  /** Today's quests with live progress. */
  quests: QuestState[];

  todayXp: number;
  weekXp: number;
}

export function cardKey(lessonId: string, cardId: string): string {
  return `${lessonId}::${cardId}`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function chronological(events: XpEvent[]): XpEvent[] {
  return [...events].sort((a, b) =>
    a.created_at === b.created_at ? (a.id ?? '').localeCompare(b.id ?? '') : a.created_at - b.created_at,
  );
}

export function deriveGamification(events: XpEvent[], now: number): GamificationState {
  const ordered = chronological(events);

  let xp = 0;
  let correct = 0;
  let wrong = 0;
  let cardsRead = 0;
  let todayXp = 0;
  let weekXp = 0;
  let currentCombo = 0;
  let maxCombo = 0;
  let run = 0;

  const completedLessons: string[] = [];
  const perfectLessons: string[] = [];
  const starsByLesson: Record<string, number> = {};
  const readCards = new Set<string>();
  const lessonBest = new Map<string, number>();
  const lessonPerfect = new Set<string>();

  for (const event of ordered) {
    xp += event.xp;
    if (isSameLocalDay(event.created_at, now)) todayXp += event.xp;
    if (event.created_at >= now - WEEK_MS) weekXp += event.xp;

    switch (event.kind) {
      case 'quiz_correct':
        correct += 1;
        run += 1;
        if (run > maxCombo) maxCombo = run;
        break;
      case 'quiz_wrong':
        wrong += 1;
        run = 0;
        break;
      case 'card_read':
        cardsRead += 1;
        if (event.lesson_id && event.card_id) readCards.add(cardKey(event.lesson_id, event.card_id));
        break;
      case 'lesson_completed': {
        if (!event.lesson_id) break;
        const score = event.score ?? 0;
        const stars = starsForScore(score);
        const prior = lessonBest.get(event.lesson_id);
        if (prior === undefined) {
          lessonBest.set(event.lesson_id, score);
          completedLessons.push(event.lesson_id);
          starsByLesson[event.lesson_id] = stars;
        } else {
          lessonBest.set(event.lesson_id, Math.max(prior, score));
          starsByLesson[event.lesson_id] = Math.max(starsByLesson[event.lesson_id] ?? 0, stars);
        }
        if (score >= 0.999 && !lessonPerfect.has(event.lesson_id)) {
          lessonPerfect.add(event.lesson_id);
          perfectLessons.push(event.lesson_id);
        }
        break;
      }
      default:
        break;
    }
  }
  currentCombo = run;

  // ---- Streaks over local days ------------------------------------------
  const dayKeys = sortedUniqueDayKeys(events);
  const activeDays = new Set(dayKeys);
  const todayKey = localDayKey(now);
  const activeToday = activeDays.has(todayKey);
  const anchor = activeToday ? todayKey : activeDays.has(previousDayKey(todayKey)) ? previousDayKey(todayKey) : null;
  let current = 0;
  if (anchor) {
    let cursor: string | null = anchor;
    while (cursor && activeDays.has(cursor)) {
      current += 1;
      cursor = previousDayKey(cursor);
    }
  }
  let longest = 0;
  let runDays = 0;
  let previous: string | null = null;
  for (const key of dayKeys) {
    runDays = previous !== null && previousDayKey(key) === previous ? runDays + 1 : 1;
    if (runDays > longest) longest = runDays;
    previous = key;
  }

  // ---- Level -------------------------------------------------------------
  const level = levelForXp(xp);
  const xpIntoLevel = xp - xpToReachLevel(level);
  const xpForNextLevel =
    level >= MAX_LEVEL ? xpToReachLevel(MAX_LEVEL) : xpToReachLevel(level + 1);
  const xpToNextLevel = level >= MAX_LEVEL ? 0 : xpForNextLevel - xpToReachLevel(level);

  const answered = correct + wrong;
  const accuracy = answered > 0 ? correct / answered : 0;

  const base = {
    xp,
    level,
    levelTitleKey: levelTitleKey(level),
    xpIntoLevel,
    xpForNextLevel,
    xpToNextLevel,
    correct,
    wrong,
    answered,
    accuracy,
    lessonsCompleted: completedLessons.length,
    completedLessons,
    perfectCount: perfectLessons.length,
    perfectLessons,
    cardsRead,
    readCards,
    currentCombo,
    maxCombo,
    streak: { current, longest, activeToday },
    starsByLesson,
    totalStars: Object.values(starsByLesson).reduce((sum, n) => sum + n, 0),
    todayXp,
    weekXp,
  };

  const context = { state: base, events: ordered, now };
  const badges = BADGES.filter((badge) => badge.check(context)).map((badge) => badge.id);
  const quests = pickDailyQuests(localDayKey(now)).map((def) => {
    const progress = Math.min(def.progress(ordered, now), def.target);
    return {
      id: def.id,
      icon: def.icon,
      titleKey: def.titleKey,
      target: def.target,
      reward: def.reward,
      progress,
      done: progress >= def.target,
    };
  });

  return { ...base, badges, quests };
}

/** The state an empty (brand new) student has — used before data loads. */
export function emptyGamificationState(now = Date.now()): GamificationState {
  return deriveGamification([], now);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface BadgeContext {
  state: Pick<
    GamificationState,
    | 'lessonsCompleted'
    | 'perfectCount'
    | 'correct'
    | 'streak'
    | 'maxCombo'
    | 'cardsRead'
    | 'level'
  >;
  events: XpEvent[];
  now: number;
}

export interface BadgeDef {
  id: string;
  icon: string;
  nameKey: string;
  descKey: string;
  check(ctx: BadgeContext): boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const BADGES: BadgeDef[] = [
  {
    id: 'first_step',
    icon: '🎒',
    nameKey: 'badge.first_step.name',
    descKey: 'badge.first_step.desc',
    check: (ctx) => ctx.state.lessonsCompleted >= 1,
  },
  {
    id: 'perfect',
    icon: '🌟',
    nameKey: 'badge.perfect.name',
    descKey: 'badge.perfect.desc',
    check: (ctx) => ctx.state.perfectCount >= 1,
  },
  {
    id: 'perfect_five',
    icon: '✨',
    nameKey: 'badge.perfect_five.name',
    descKey: 'badge.perfect_five.desc',
    check: (ctx) => ctx.state.perfectCount >= 5,
  },
  {
    id: 'quiz_novice',
    icon: '🎯',
    nameKey: 'badge.quiz_novice.name',
    descKey: 'badge.quiz_novice.desc',
    check: (ctx) => ctx.state.correct >= 10,
  },
  {
    id: 'quiz_master',
    icon: '🏹',
    nameKey: 'badge.quiz_master.name',
    descKey: 'badge.quiz_master.desc',
    check: (ctx) => ctx.state.correct >= 50,
  },
  {
    id: 'streak_3',
    icon: '🔥',
    nameKey: 'badge.streak_3.name',
    descKey: 'badge.streak_3.desc',
    check: (ctx) => ctx.state.streak.longest >= 3,
  },
  {
    id: 'streak_7',
    icon: '🌈',
    nameKey: 'badge.streak_7.name',
    descKey: 'badge.streak_7.desc',
    check: (ctx) => ctx.state.streak.longest >= 7,
  },
  {
    id: 'combo_5',
    icon: '⚡',
    nameKey: 'badge.combo_5.name',
    descKey: 'badge.combo_5.desc',
    check: (ctx) => ctx.state.maxCombo >= 5,
  },
  {
    id: 'bookworm',
    icon: '🐛',
    nameKey: 'badge.bookworm.name',
    descKey: 'badge.bookworm.desc',
    check: (ctx) => ctx.state.cardsRead >= 50,
  },
  {
    id: 'scholar',
    icon: '🎓',
    nameKey: 'badge.scholar.name',
    descKey: 'badge.scholar.desc',
    check: (ctx) => ctx.state.lessonsCompleted >= 15,
  },
  {
    id: 'level_5',
    icon: '🏆',
    nameKey: 'badge.level_5.name',
    descKey: 'badge.level_5.desc',
    check: (ctx) => ctx.state.level >= 5,
  },
  {
    id: 'comeback',
    icon: '🦸',
    nameKey: 'badge.comeback.name',
    descKey: 'badge.comeback.desc',
    check: (ctx) => {
      for (let i = 1; i < ctx.events.length; i++) {
        if (ctx.events[i].created_at - ctx.events[i - 1].created_at >= 7 * DAY_MS) return true;
      }
      return false;
    },
  },
  {
    id: 'early_bird',
    icon: '🐦',
    nameKey: 'badge.early_bird.name',
    descKey: 'badge.early_bird.desc',
    check: (ctx) =>
      ctx.events.some((event) => {
        if (event.kind !== 'quiz_correct') return false;
        const hour = new Date(event.created_at).getHours();
        return hour >= 5 && hour < 8;
      }),
  },
];

export const BADGE_IDS: readonly string[] = BADGES.map((badge) => badge.id);

// ---------------------------------------------------------------------------
// Daily quests
// ---------------------------------------------------------------------------

export interface QuestDef {
  id: string;
  icon: string;
  titleKey: string;
  target: number;
  reward: number;
  /** Progress of this quest given the full event log and `now`. */
  progress(events: XpEvent[], now: number): number;
}

function eventsToday(events: XpEvent[], now: number): XpEvent[] {
  return events.filter((event) => isSameLocalDay(event.created_at, now));
}

function bestComboIn(events: XpEvent[]): number {
  let run = 0;
  let best = 0;
  for (const event of chronological(events)) {
    if (event.kind === 'quiz_correct') {
      run += 1;
      if (run > best) best = run;
    } else if (event.kind === 'quiz_wrong') {
      run = 0;
    }
  }
  return best;
}

export const QUEST_POOL: QuestDef[] = [
  {
    id: 'q_lesson',
    icon: '📖',
    titleKey: 'quest.q_lesson.title',
    target: 1,
    reward: 30,
    progress: (events, now) => eventsToday(events, now).filter((e) => e.kind === 'lesson_completed').length,
  },
  {
    id: 'q_correct',
    icon: '🎯',
    titleKey: 'quest.q_correct.title',
    target: 3,
    reward: 25,
    progress: (events, now) => eventsToday(events, now).filter((e) => e.kind === 'quiz_correct').length,
  },
  {
    id: 'q_combo',
    icon: '⚡',
    titleKey: 'quest.q_combo.title',
    target: 2,
    reward: 20,
    progress: (events, now) => bestComboIn(eventsToday(events, now)),
  },
  {
    id: 'q_perfect',
    icon: '🌟',
    titleKey: 'quest.q_perfect.title',
    target: 1,
    reward: 35,
    progress: (events, now) =>
      eventsToday(events, now).filter((e) => e.kind === 'lesson_completed' && (e.score ?? 0) >= 0.999)
        .length,
  },
  {
    id: 'q_read',
    icon: '👀',
    titleKey: 'quest.q_read.title',
    target: 6,
    reward: 15,
    progress: (events, now) => eventsToday(events, now).filter((e) => e.kind === 'card_read').length,
  },
  {
    id: 'q_xp',
    icon: '💰',
    titleKey: 'quest.q_xp.title',
    target: 75,
    reward: 20,
    progress: (events, now) => eventsToday(events, now).reduce((sum, e) => sum + e.xp, 0),
  },
];

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0;
  }
  return hash;
}

/**
 * Deterministic daily quest selection: the same three quests for everyone on
 * a given day, rotating each day via a seeded shuffle of the pool.
 */
export function pickDailyQuests(dayKey: string): QuestDef[] {
  let seed = hashString(dayKey);
  const pool = [...QUEST_POOL];
  const picked: QuestDef[] = [];
  while (picked.length < 3 && pool.length > 0) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const index = seed % pool.length;
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked.sort((a, b) => QUEST_POOL.indexOf(a) - QUEST_POOL.indexOf(b));
}

/** Quest bonuses that are complete but not yet granted as an XP event. */
export function pendingQuestBonuses(events: XpEvent[], now: number): QuestState[] {
  return deriveGamification(events, now).quests.filter(
    (quest) =>
      quest.done &&
      !events.some(
        (event) =>
          event.kind === 'quest_bonus' &&
          event.quest_id === quest.id &&
          isSameLocalDay(event.created_at, now),
      ),
  );
}

// ---------------------------------------------------------------------------
// Award planning (pure — the store turns these into real events)
// ---------------------------------------------------------------------------

/**
 * Rewards granted when the FIRST learning event of a day lands: the daily
 * bonus, plus the streak bonus when yesterday (or earlier) was active.
 * Returns [] when today already has activity.
 */
function dayOpeningAwards(state: GamificationState, now: number): PlannedAward[] {
  if (state.streak.activeToday) return [];
  const awards: PlannedAward[] = [{ kind: 'daily_first', xp: XP_RULES.dailyFirst, created_at: now }];
  const streakDays = state.streak.current; // run ending yesterday (0 when cold)
  if (streakDays >= 1) {
    awards.push({ kind: 'streak_bonus', xp: streakBonusXp(streakDays), created_at: now });
  }
  return awards;
}

export interface PlannedAward {
  kind: XpEvent['kind'];
  xp: number;
  created_at: number;
  lesson_id?: string;
  question_id?: string;
  card_id?: string;
  score?: number;
  quest_id?: string;
}

/** A card read: [] when this exact card was already read (no XP farming). */
export function planCardRead(
  events: XpEvent[],
  lessonId: string,
  cardId: string,
  now: number,
): PlannedAward[] {
  const state = deriveGamification(events, now);
  if (state.readCards.has(cardKey(lessonId, cardId))) return [];
  return [
    ...dayOpeningAwards(state, now),
    { kind: 'card_read', xp: XP_RULES.cardRead, created_at: now, lesson_id: lessonId, card_id: cardId },
  ];
}

/** A quiz submission: combo bonus when correct, effort points when wrong. */
export function planQuizAnswer(
  events: XpEvent[],
  lessonId: string,
  questionId: string,
  correct: boolean,
  now: number,
): PlannedAward[] {
  const state = deriveGamification(events, now);
  const comboAfter = correct ? state.currentCombo + 1 : 0;
  const xp = correct
    ? XP_RULES.quizCorrect + comboBonusXp(comboAfter)
    : XP_RULES.quizAttempt;
  return [
    ...dayOpeningAwards(state, now),
    {
      kind: correct ? 'quiz_correct' : 'quiz_wrong',
      xp,
      created_at: now,
      lesson_id: lessonId,
      question_id: questionId,
    },
  ];
}

/**
 * A lesson completion: full XP the first time, a smaller amount when a replay
 * beats the student's star best, plus the one-time perfect bonus.
 */
export function planLessonComplete(
  events: XpEvent[],
  lessonId: string,
  score: number,
  now: number,
): PlannedAward[] {
  const state = deriveGamification(events, now);
  const first = !state.completedLessons.includes(lessonId);
  const priorStars = state.starsByLesson[lessonId] ?? 0;
  const improved = starsForScore(score) > priorStars;
  const xp = first ? XP_RULES.lessonCompleted : improved ? XP_RULES.lessonReplayImproved : 0;
  const awards: PlannedAward[] = [
    ...dayOpeningAwards(state, now),
    { kind: 'lesson_completed', xp, created_at: now, lesson_id: lessonId, score },
  ];
  const alreadyPerfect = state.perfectLessons.includes(lessonId);
  if (score >= 0.999 && !alreadyPerfect) {
    awards.push({
      kind: 'perfect_bonus',
      xp: XP_RULES.perfectBonus,
      created_at: now,
      lesson_id: lessonId,
      score,
    });
  }
  return awards;
}
