/**
 * Topic-figure registry tests.
 *
 * The figures are the lesson's teaching aid, so the mapping has to stay
 * complete: every shipped lesson needs a figure, the registry must resolve,
 * and no lesson may silently fall back to the generic scene.
 */

import { describe, expect, it } from 'vitest';
import { FIGURES, LESSON_FIGURES, figureForLesson } from '../src/art/figures';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CONTENT_DIR = resolve(import.meta.dirname, '../../../content');

function shippedLessonIds(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(CONTENT_DIR, 'manifest.json'), 'utf8'),
  ) as { files: Record<string, string>; lessons: Array<{ id: string }> };
  return manifest.lessons.map((l) => l.id);
}

describe('topic figures', () => {
  it('registry entries all resolve', () => {
    for (const [name, figure] of Object.entries(FIGURES)) {
      expect(figure, name).toBeTruthy();
    }
    expect(FIGURES.generic).toBeDefined();
  });

  it('every mapped figure exists in the registry', () => {
    for (const [lessonId, figureId] of Object.entries(LESSON_FIGURES)) {
      expect(FIGURES[figureId], `${lessonId} -> ${figureId}`).toBeDefined();
    }
  });

  it('covers every shipped lesson with a figure', () => {
    const missing = shippedLessonIds().filter((id) => !LESSON_FIGURES[id]);
    expect(missing, `lessons without a topic figure: ${missing.join(', ')}`).toEqual([]);
  });

  it('math lessons get geometry/motion figures, not the generic one', () => {
    const maths = Object.entries(LESSON_FIGURES).filter(([id]) => id.includes('-math-'));
    expect(maths.length).toBeGreaterThan(0);
    for (const [id, figureId] of maths) {
      expect(figureId, `${id} should not be generic`).not.toBe('generic');
    }
  });

  it('falls back to the generic figure for an unknown lesson', () => {
    expect(figureForLesson('does-not-exist')).toBe(FIGURES.generic);
    expect(figureForLesson(undefined)).toBe(FIGURES.generic);
  });

  it('returns the mapped figure for a known lesson', () => {
    expect(figureForLesson('c10-math-quadratic-equations')).toBe(FIGURES.parabola);
    expect(figureForLesson('c9-sci-motion')).toBe(FIGURES.velocityTime);
    expect(figureForLesson('c10-sci-light')).toBe(FIGURES.reflection);
  });
});