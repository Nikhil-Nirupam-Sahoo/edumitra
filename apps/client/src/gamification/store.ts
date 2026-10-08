/**
 * Gamification store — the reactive, offline-first write path for XP events.
 *
 * Writes follow the same doctrine as the rest of the app:
 *  - every reward is an idempotent `put` into `xp_events` (safe to replay),
 *  - all side effects happen BEFORE the UI hears about them,
 *  - state shown in the UI is derived from the event log by the pure engine.
 *
 * A single serialized lock keeps concurrent taps (fast quiz answering) from
 * interleaving plan/append cycles, and `useSyncExternalStore` gives React 19
 * subscribers the exact same snapshot React sees (no tearing).
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  appendXpEvents,
  getXpEvents,
} from '../db/client';
import type { XpEvent } from '../db/schema';
import {
  deriveGamification,
  emptyGamificationState,
  pendingQuestBonuses,
  planCardRead,
  planLessonComplete,
  planQuizAnswer,
  starsForScore,
  type GamificationState,
  type PlannedAward,
} from './engine';

export interface XpGain {
  /** Total XP gained by this single action (including day/streak/perfect/quest bonuses). */
  xp: number;
  /** Combo after the action (0 after a wrong answer). */
  combo: number;
  levelBefore: number;
  levelAfter: number;
  /** Badges earned, in BADGES order. */
  newBadges: string[];
  /** Daily quest ids that crossed their target with this action. */
  newlyCompletedQuests: string[];
  /** Stars for a lesson completion (0 for non-completion actions). */
  stars: number;
  /** Whether this completion was a perfect (100%) score. */
  perfect: boolean;
}

export interface GamificationSnapshot {
  status: 'idle' | 'loading' | 'ready';
  studentId: string | null;
  state: GamificationState;
}

interface StoreState extends GamificationSnapshot {
  events: XpEvent[];
}

const IDLE: StoreState = {
  status: 'idle',
  studentId: null,
  events: [],
  state: emptyGamificationState(),
};

let current: StoreState = IDLE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function mutate(next: (state: StoreState) => StoreState): void {
  current = next(current);
  notify();
}

/** Serializes plan→append→derive cycles so rapid taps can't interleave. */
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

/** Loads the given student's event log once, then keeps it current in memory. */
export async function ensureLoaded(studentId: string): Promise<void> {
  if (current.studentId === studentId && (current.status === 'ready' || current.status === 'loading')) {
    await waitUntilReady(studentId);
    return;
  }
  mutate((state) => ({ ...state, studentId, status: 'loading', events: [] }));
  const events = await getXpEvents(studentId);
  mutate(() => ({
    studentId,
    status: 'ready',
    events,
    state: deriveGamification(events, Date.now()),
  }));
}

function waitUntilReady(studentId: string): Promise<void> {
  return new Promise((resolve) => {
    if (current.studentId === studentId && current.status === 'ready') {
      resolve();
      return;
    }
    const unsubscribe = subscribe(() => {
      if (current.studentId === studentId && current.status === 'ready') {
        unsubscribe();
        resolve();
      }
    });
  });
}

function nextEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `xp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function runAwards(
  studentId: string,
  builder: (events: XpEvent[], now: number) => PlannedAward[],
  finish?: (after: GamificationState) => Partial<Pick<XpGain, 'stars' | 'perfect'>>,
): Promise<XpGain | null> {
  return withLock(async () => {
    await ensureLoaded(studentId);
    const now = Date.now();
    const before = current.state;
    const awards = builder(current.events, now);
    if (awards.length === 0) return null;

    const events: XpEvent[] = awards.map((award) => ({
      id: nextEventId(),
      student_id: studentId,
      ...award,
    }));
    const all = [...current.events, ...events];

    // Quest rewards are granted at write time for any quest that just crossed
    // its target (pendingQuestBonuses is one-grant-per-quest-per-day).
    const bonusQuests = pendingQuestBonuses(all, now);
    if (bonusQuests.length > 0) {
      const bonusEvents: XpEvent[] = bonusQuests.map((quest) => ({
        id: nextEventId(),
        student_id: studentId,
        kind: 'quest_bonus',
        xp: quest.reward,
        created_at: now,
        quest_id: quest.id,
      }));
      events.push(...bonusEvents);
      all.push(...bonusEvents);
    }

    await appendXpEvents(events);
    const after = deriveGamification(all, now);
    mutate(() => ({ studentId, status: 'ready', events: all, state: after }));

    const gained: XpGain = {
      xp: after.xp - before.xp,
      combo: after.currentCombo,
      levelBefore: before.level,
      levelAfter: after.level,
      newBadges: after.badges.filter((id) => !before.badges.includes(id)),
      newlyCompletedQuests: after.quests
        .filter((quest) => quest.done && !before.quests.some((old) => old.id === quest.id && old.done))
        .map((quest) => quest.id),
      stars: 0,
      perfect: false,
      ...(finish?.(after) ?? {}),
    };
    return gained;
  });
}

/** A quiz submission: correct → XP + combo bonus, wrong → effort points. */
export function recordQuizAnswer(args: {
  studentId: string;
  lessonId: string;
  questionId: string;
  correct: boolean;
}): Promise<XpGain | null> {
  return runAwards(args.studentId, (events, now) =>
    planQuizAnswer(events, args.lessonId, args.questionId, args.correct, now),
  );
}

/** A card read; deduped by (lesson, card) so replays can't farm XP. */
export function recordCardRead(args: {
  studentId: string;
  lessonId: string;
  cardId: string;
}): Promise<XpGain | null> {
  return runAwards(args.studentId, (events, now) =>
    planCardRead(events, args.lessonId, args.cardId, now),
  );
}

/** A lesson completion: full XP first time, replay-improvement later, plus perfect bonus. */
export function recordLessonComplete(args: {
  studentId: string;
  lessonId: string;
  score: number;
}): Promise<XpGain | null> {
  return runAwards(
    args.studentId,
    (events, now) => planLessonComplete(events, args.lessonId, args.score, now),
    () => ({
      stars: starsForScore(args.score),
      perfect: args.score >= 0.999,
    }),
  );
}

/** Clear in-memory state after a full data reset (Settings → Reset). */
export function resetGamificationStore(): void {
  current = IDLE;
  notify();
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): GamificationSnapshot {
  const { events: _events, ...snapshot } = current;
  return snapshot;
}

/**
 * Subscribe a component to one student's gamification state. Reloads when the
 * student switches; record actions return an `XpGain` describing what the UI
 * should celebrate (level-ups, badges, quests, stars).
 */
export function useGamification(studentId: string): GamificationSnapshot & {
  recordQuizAnswer: typeof recordQuizAnswer;
  recordCardRead: typeof recordCardRead;
  recordLessonComplete: typeof recordLessonComplete;
} {
  useEffect(() => {
    void ensureLoaded(studentId);
  }, [studentId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return {
    ...snapshot,
    recordQuizAnswer,
    recordCardRead,
    recordLessonComplete,
  };
}

/** One student's derived state, for non-React contexts (e.g. dashboard widgets). */
export async function getGamificationFor(
  studentId: string,
  now = Date.now(),
): Promise<GamificationState> {
  const events = await getXpEvents(studentId);
  return deriveGamification(events, now);
}