/**
 * Game high scores — one record per (student, mode).
 *
 * Persisted in the `meta` store as a small JSON blob per key, so no schema
 * change is needed and a wipe (Settings → Reset) clears scores for free.
 * Only the best result is kept, which is what a leaderboard actually shows.
 */

import { getMeta, setMeta } from '../db/client';

export type GameMode = 'blitz' | 'sprint' | 'truefalse' | 'memory';

const key = (studentId: string, mode: GameMode) => `games.best.${studentId}.${mode}`;

export interface Score {
  /** Points earned — accuracy weighted, with a speed bonus. */
  score: number;
  correct: number;
  total: number;
  /** Epoch ms. */
  at: number;
}

export async function getBest(studentId: string, mode: GameMode): Promise<Score | null> {
  try {
    const raw = await getMeta(key(studentId, mode));
    if (!raw) return null;
    return JSON.parse(raw) as Score;
  } catch {
    return null;
  }
}

/** Records a result; returns true when it beat the stored best. */
export async function recordScore(
  studentId: string,
  mode: GameMode,
  score: Omit<Score, 'at'>,
): Promise<boolean> {
  const previous = await getBest(studentId, mode);
  if (previous && previous.score >= score.score) return false;
  await setMeta(
    key(studentId, mode),
    JSON.stringify({ ...score, at: Date.now() } satisfies Score),
  );
  return true;
}

export async function getAllBest(
  studentId: string,
  modes: readonly GameMode[],
): Promise<Partial<Record<GameMode, Score>>> {
  const out: Partial<Record<GameMode, Score>> = {};
  for (const mode of modes) {
    const score = await getBest(studentId, mode);
    if (score) out[mode] = score;
  }
  return out;
}