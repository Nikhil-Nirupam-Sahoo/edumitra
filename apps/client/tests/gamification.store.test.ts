/**
 * Gamification store tests — the React binding contract.
 *
 * The critical regression this file exists for: `getSnapshot` must return a
 * REFERENTIALLY STABLE object between real changes. `useSyncExternalStore`
 * compares snapshots with `Object.is`; if every call allocates a new object,
 * React sees a change on every check, renders forever, and finally tears the
 * tree down — which shows up in production as a blank white screen.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ensureLoaded,
  getSnapshot,
  recordQuizAnswer,
  resetGamificationStore,
  subscribe,
} from '../src/gamification/store';
import { clearAllData } from '../src/db/client';

const STUDENT = 'student-aarav';
const LESSON = 'c8-math-rational-numbers';

describe('store snapshot stability', () => {
  beforeEach(async () => {
    resetGamificationStore();
    await clearAllData();
  });

  it('returns the identical object across repeated reads (no render loop)', () => {
    const first = getSnapshot();
    const second = getSnapshot();
    const third = getSnapshot();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('keeps the snapshot stable while nothing changes', async () => {
    await ensureLoaded(STUDENT);
    const afterLoad = getSnapshot();
    // Reading repeatedly between writes must not allocate new objects.
    expect(getSnapshot()).toBe(afterLoad);
    expect(getSnapshot()).toBe(afterLoad);
  });

  it('produces a NEW snapshot only when state actually changes', async () => {
    await ensureLoaded(STUDENT);
    const before = getSnapshot();
    await recordQuizAnswer({
      studentId: STUDENT,
      lessonId: LESSON,
      questionId: 'q1',
      correct: true,
    });
    const after = getSnapshot();
    expect(after).not.toBe(before);
    expect(after.state.xp).toBeGreaterThan(before.state.xp);
    // And it settles again immediately after the write.
    expect(getSnapshot()).toBe(after);
  });

  it('notifies subscribers exactly once per write', async () => {
    await ensureLoaded(STUDENT);
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    await recordQuizAnswer({
      studentId: STUDENT,
      lessonId: LESSON,
      questionId: 'q1',
      correct: true,
    });
    unsubscribe();
    expect(calls).toBe(1);
  });

  it('reset returns to the shared idle snapshot', async () => {
    await ensureLoaded(STUDENT);
    expect(getSnapshot().status).toBe('ready');
    resetGamificationStore();
    const afterReset = getSnapshot();
    expect(afterReset.status).toBe('idle');
    expect(afterReset.studentId).toBeNull();
    // Stable again after reset.
    expect(getSnapshot()).toBe(afterReset);
  });
});