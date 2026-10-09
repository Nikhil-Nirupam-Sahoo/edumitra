/**
 * Seed integration test — exercises the REAL seed path against fake-indexeddb.
 *
 * The home screen shows nothing when the store is empty, so a seeding failure
 * is invisible in the UI. This test fails loudly instead.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getLessons, getAllStudents } from '../src/db/client';
import { buildSeedLessons, buildSeedStudents, seedIfEmpty } from '../src/db/seed';
import { parseLessonContent } from '../src/modules/lesson/lessonModel';

describe('seed', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('builds a valid syllabus without throwing', () => {
    const lessons = buildSeedLessons();
    expect(lessons.length).toBe(36);
    for (const lesson of lessons) {
      const content = parseLessonContent(lesson.content_json, lesson.id);
      expect(content.cards.length, lesson.id).toBeGreaterThan(0);
      expect(
        content.cards.some((c) => c.type === 'quiz'),
        `${lesson.id} has a quiz`,
      ).toBe(true);
      expect(
        content.cards[content.cards.length - 1]?.type,
        `${lesson.id} ends with summary`,
      ).toBe('summary');
    }
  });

  it('seeds lessons into IndexedDB on first run', async () => {
    expect(await getLessons()).toHaveLength(0);
    await seedIfEmpty();
    const lessons = await getLessons();
    expect(lessons.length).toBe(36);
    expect(lessons.every((l) => l.grade === 8 || l.grade === 9 || l.grade === 10)).toBe(true);
    expect(lessons.filter((l) => l.grade === 8)).toHaveLength(12);
    expect(lessons.filter((l) => l.grade === 9)).toHaveLength(12);
    expect(lessons.filter((l) => l.grade === 10)).toHaveLength(12);
  });

  it('seeds students', async () => {
    await seedIfEmpty();
    const students = await getAllStudents();
    expect(students.length).toBeGreaterThan(0);
    expect(students.map((s) => s.class_id)).toContain('class-8-a');
  });

  it('is idempotent — running twice does not duplicate', async () => {
    await seedIfEmpty();
    await seedIfEmpty();
    expect(await getLessons()).toHaveLength(36);
    expect(await getAllStudents()).toHaveLength(6);
  });

  it('backfills new lessons onto an existing install', async () => {
    // Simulate an old device that only has the pre-syllabus demo lessons.
    const { upsertLessons } = await import('../src/db/client');
    await upsertLessons([
      {
        id: 'math-fractions-1',
        title: 'Understanding Fractions',
        language: 'en',
        version: 1,
        content_json: JSON.stringify({ version: 1, language: 'en', cards: [] }),
        updated_at: Date.now(),
      },
    ]);
    await seedIfEmpty();
    const lessons = await getLessons();
    expect(lessons.length).toBe(37); // legacy + 36 syllabus
    expect(lessons.some((l) => l.id === 'math-fractions-1')).toBe(true);
    expect(lessons.filter((l) => l.grade === 10)).toHaveLength(12);
  });
});