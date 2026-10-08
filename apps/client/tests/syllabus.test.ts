/**
 * Syllabus content validation — every lesson must parse and pass the engine
 * rules (unique ids, valid quizzes, at least one quiz, ends with summary).
 */

import { describe, expect, it } from 'vitest';
import { CLASS_8_LESSONS } from '../src/content/class8';
import { CLASS_9_LESSONS } from '../src/content/class9';
import { CLASS_10_LESSONS } from '../src/content/class10';
import { validateSyllabusLesson, toLessonRecord, type SeedLesson } from '../src/content/types';

const ALL_LESSONS: SeedLesson[] = [...CLASS_8_LESSONS, ...CLASS_9_LESSONS, ...CLASS_10_LESSONS];

describe('syllabus coverage', () => {
  it('has exactly 36 lessons (12 per class)', () => {
    expect(ALL_LESSONS.length).toBe(36);
    expect(CLASS_8_LESSONS.length).toBe(12);
    expect(CLASS_9_LESSONS.length).toBe(12);
    expect(CLASS_10_LESSONS.length).toBe(12);
  });

  it('covers 4 subjects in each grade', () => {
    for (const grade of [8, 9, 10]) {
      const subjects = new Set(
        ALL_LESSONS.filter((l) => l.grade === grade).map((l) => l.subject),
      );
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
      const record = toLessonRecord(lesson, 1, updatedAt);
      expect(record.id).toBe(lesson.id);
      expect(record.title).toBe(lesson.title);
      expect(record.grade).toBe(lesson.grade);
      expect(record.subject).toBe(lesson.subject);
      // Round-trip parse
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
          // Explanation should not just repeat the question
          expect(card.explanation!.trim().toLowerCase()).not.toBe(card.question.trim().toLowerCase());
        }
      }
    }
  });
});