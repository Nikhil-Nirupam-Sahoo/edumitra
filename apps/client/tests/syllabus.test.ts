/**
 * Syllabus content validation — every lesson must parse and pass the engine
 * rules (unique ids, valid quizzes, at least one quiz, ends with summary).
 */

import { describe, expect, it } from 'vitest';
import {
  CONTENT_MANIFEST,
  CONTENT_VERSION,
  loadSyllabusLessons,
  validateSyllabusLesson,
  type SeedLesson,
} from '../src/content';
import { toLessonRecord } from '../src/db/seed';

const ALL_LESSONS: SeedLesson[] = loadSyllabusLessons();
const lessonsByGrade = (grade: number) => ALL_LESSONS.filter((l) => l.grade === grade);

describe('syllabus coverage', () => {
  it('has exactly 36 lessons (12 per class)', () => {
    expect(ALL_LESSONS.length).toBe(36);
    expect(lessonsByGrade(8).length).toBe(12);
    expect(lessonsByGrade(9).length).toBe(12);
    expect(lessonsByGrade(10).length).toBe(12);
  });

  it('manifest counts match the actual data files', () => {
    expect(CONTENT_MANIFEST.counts.class8).toBe(lessonsByGrade(8).length);
    expect(CONTENT_MANIFEST.counts.class9).toBe(lessonsByGrade(9).length);
    expect(CONTENT_MANIFEST.counts.class10).toBe(lessonsByGrade(10).length);
    expect(CONTENT_MANIFEST.counts.total).toBe(ALL_LESSONS.length);
    expect(CONTENT_MANIFEST.lessons.length).toBe(ALL_LESSONS.length);
    for (const entry of CONTENT_MANIFEST.lessons) {
      const lesson = ALL_LESSONS.find((l) => l.id === entry.id);
      expect(lesson, entry.id).toBeDefined();
      expect(lesson!.title).toBe(entry.title);
      expect(lesson!.cards.length).toBe(entry.cards);
    }
  });

  it('declares a positive content version', () => {
    expect(CONTENT_VERSION).toBeGreaterThan(0);
  });

  it('covers 4 subjects in each grade', () => {
    for (const grade of [8, 9, 10]) {
      const subjects = new Set(lessonsByGrade(grade).map((l) => l.subject));
      expect(subjects.size).toBe(4);
      expect(subjects.has('math')).toBe(true);
      expect(subjects.has('science')).toBe(true);
      expect(subjects.has('sst')).toBe(true);
      expect(subjects.has('english')).toBe(true);
    }
  });

  it('every lesson id is unique and follows c{grade}-{subject}-{slug}', () => {
    const ids = new Set<string>();
    for (const lesson of ALL_LESSONS) {
      expect(ids.has(lesson.id)).toBe(false);
      ids.add(lesson.id);
      expect(lesson.id).toMatch(/^c(8|9|10)-(math|sci|sst|en|english)-/);
    }
  });

  it('every lesson passes the structural validator', () => {
    for (const lesson of ALL_LESSONS) {
      expect(() => validateSyllabusLesson(lesson.cards)).not.toThrow();
    }
  });

  it('every lesson serializes and deserializes without loss', () => {
    const updatedAt = Date.now();
    for (const lesson of ALL_LESSONS) {
      const record = toLessonRecord(lesson, CONTENT_VERSION, updatedAt);
      expect(record.id).toBe(lesson.id);
      expect(record.title).toBe(lesson.title);
      expect(record.grade).toBe(lesson.grade);
      expect(record.subject).toBe(lesson.subject);
      const parsed = JSON.parse(record.content_json);
      expect(parsed.cards.length).toBe(lesson.cards.length);
    }
  });
});

describe('quiz quality', () => {
  it('every quiz question has a clear explanation', () => {
    for (const lesson of ALL_LESSONS) {
      for (const card of lesson.cards) {
        if (card.type === 'quiz') {
          expect(card.explanation).toBeDefined();
          expect(card.explanation!.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('no quiz question duplicates its own explanation', () => {
    for (const lesson of ALL_LESSONS) {
      for (const card of lesson.cards) {
        if (card.type === 'quiz') {
          expect(card.explanation!.trim().toLowerCase()).not.toBe(
            card.question.trim().toLowerCase(),
          );
        }
      }
    }
  });
});