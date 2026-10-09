/**
 * Curriculum figure tests.
 *
 * These enforce the rule that got the previous version wrong: a figure must
 * teach its chapter's actual idea, and every chapter must have one. There is
 * deliberately NO generic fallback any more — a lesson without a figure is a
 * failing test, so gaps can't quietly become decoration.
 */

import { describe, expect, it } from 'vitest';
import { FIGURES, FIGURE_IDS, LESSON_FIGURES, figureForLesson } from '../src/art/figures';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CONTENT_DIR = resolve(import.meta.dirname, '../../../content');

function manifestLessons(): Array<{ id: string; title: string; subject: string; grade: number }> {
  const manifest = JSON.parse(readFileSync(join(CONTENT_DIR, 'manifest.json'), 'utf8')) as {
    lessons: Array<{ id: string; title: string; subject: string; grade: number }>;
  };
  return manifest.lessons;
}

describe('curriculum figures', () => {
  it('every shipped lesson has a figure', () => {
    const missing = manifestLessons()
      .map((l) => l.id)
      .filter((id) => !LESSON_FIGURES[id]);
    expect(missing, `lessons with no figure: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no leftover mappings for lessons that no longer exist', () => {
    const shipped = new Set(manifestLessons().map((l) => l.id));
    const orphans = Object.keys(LESSON_FIGURES).filter((id) => !shipped.has(id));
    expect(orphans, `stale mappings: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every mapped figure exists in the registry', () => {
    for (const [lessonId, figureId] of Object.entries(LESSON_FIGURES)) {
      expect(FIGURES[figureId], `${lessonId} -> ${figureId}`).toBeDefined();
    }
  });

  it('has no unused figures left in the registry', () => {
    const used = new Set(Object.values(LESSON_FIGURES));
    const unused = FIGURE_IDS.filter((id) => !used.has(id));
    expect(unused, `unused figures: ${unused.join(', ')}`).toEqual([]);
  });

  it('has no generic/decorative figure in the registry', () => {
    expect(FIGURE_IDS).not.toContain('generic');
  });

  it('never falls back — an unknown or unmapped lesson renders no figure', () => {
    expect(figureForLesson('does-not-exist')).toBeNull();
    expect(figureForLesson(undefined)).toBeNull();
  });

  it('returns the mapped figure for known lessons', () => {
    expect(figureForLesson('c8-math-rational-numbers')).toBe(FIGURES.rationalNumberLine);
    expect(figureForLesson('c9-sci-motion')).toBe(FIGURES.velocityTime);
    expect(figureForLesson('c10-sci-light')).toBe(FIGURES.lightMirrorLens);
  });

  it('pairs chapters with figures that match the chapter', () => {
    // Spot-checks that would have caught the old mismatches.
    expect(LESSON_FIGURES['c8-math-rational-numbers']).not.toBe('balance');
    expect(LESSON_FIGURES['c8-math-linear-equations']).toBe('balance');
    expect(LESSON_FIGURES['c10-sci-chemical-reactions']).toBe('reaction');
    expect(LESSON_FIGURES['c10-sci-life-processes']).toBe('photosynthesis');
    expect(LESSON_FIGURES['c8-sst-constitution']).toBe('constitutionPillars');
    expect(LESSON_FIGURES['c10-sst-federalism']).toBe('federalism');
    expect(LESSON_FIGURES['c9-sci-matter-surroundings']).toBe('particleStates');
    expect(LESSON_FIGURES['c9-sst-food-security']).toBe('foodChain');
  });

  it('covers every subject, not only maths', () => {
    const subjects = new Set(manifestLessons().map((l) => l.subject));
    expect([...subjects].sort()).toEqual(['english', 'math', 'science', 'sst']);
  });
});