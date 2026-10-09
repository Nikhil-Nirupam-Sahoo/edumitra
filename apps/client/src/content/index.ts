/**
 * Syllabus content loader.
 *
 * The curriculum is DATA, not code: the lessons live in `content/data/*.json`
 * and are described by `content/data/manifest.json`. Adding or editing a
 * chapter means editing JSON (or dropping in another file and listing it in
 * the manifest) — no TypeScript, no builder calls, no code changes.
 *
 * The JSON is bundled with the app, so a device still has every chapter with
 * zero network access. `contentVersion` in the manifest is what the seed uses
 * to decide whether an already-installed device needs refreshing.
 */

import class8 from './data/class8.json';
import class9 from './data/class9.json';
import class10 from './data/class10.json';
import manifestJson from './data/manifest.json';
import type { LessonCard, QuizCard, SummaryCard, TextCard } from '../modules/lesson/lessonModel';
import type { SyllabusGradeId, SyllabusSubjectId } from '../db/schema';

export type { SyllabusGradeId, SyllabusSubjectId };

export interface ContentManifest {
  schema: number;
  contentVersion: number;
  description: string;
  files: Record<string, string>;
  counts: Record<string, number>;
  lessons: Array<{
    id: string;
    grade: number;
    subject: string;
    title: string;
    cards: number;
    quizzes: number;
  }>;
}

/** Bumped when the curriculum changes, so installed devices re-seed. */
export const CONTENT_VERSION = manifestJson.contentVersion as number;

export const CONTENT_MANIFEST = manifestJson as ContentManifest;

const SOURCES: Record<string, unknown> = {
  class8,
  class9,
  class10,
};

/** One lesson exactly as it appears in the JSON data files. */
export interface SeedLesson {
  id: string;
  title: string;
  grade: number;
  subject: string;
  cards: LessonCard[];
}

// Content JSON is untrusted input at runtime (it may be swapped for a
// downloaded pack), so it is validated rather than cast.
function readLessons(file: string): SeedLesson[] {
  const raw = SOURCES[file];
  if (!Array.isArray(raw)) {
    throw new Error(`content/data/${file}.json must contain an array of lessons`);
  }
  const lessons: SeedLesson[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`content/data/${file}.json: lesson entry must be an object`);
    }
    const lesson = entry as Partial<SeedLesson>;
    if (typeof lesson.id !== 'string' || typeof lesson.title !== 'string') {
      throw new Error(`content/data/${file}.json: lesson needs id and title`);
    }
    if (!Array.isArray(lesson.cards)) {
      throw new Error(`lesson "${lesson.id}" has no cards array`);
    }
    lessons.push({
      id: lesson.id,
      title: lesson.title,
      grade: Number(lesson.grade),
      subject: String(lesson.subject),
      cards: lesson.cards as LessonCard[],
    });
  }
  return lessons;
}

/** Every bundled lesson, in manifest file order. */
export function loadSyllabusLessons(): SeedLesson[] {
  return Object.keys(CONTENT_MANIFEST.files).flatMap((file) => readLessons(file));
}

/* -------------------------------------------------------------------------- */
/* Validation helpers used by the seed and by tests.                          */
/* -------------------------------------------------------------------------- */

export function textCard(id: string, title: string, body: string): TextCard {
  return { id, type: 'text', title, body };
}

export function summaryCard(id: string, body: string): SummaryCard {
  return { id, type: 'summary', title: '🌟', body };
}

export function quizCard(
  cardId: string,
  questionId: string,
  question: string,
  options: string[],
  correctIndex: number,
  explanation: string,
): QuizCard {
  if (options.length < 2 || options.length > 4) {
    throw new Error(`quiz "${questionId}" needs 2-4 options (got ${options.length})`);
  }
  if (correctIndex < 0 || correctIndex >= options.length) {
    throw new Error(`quiz "${questionId}" correctIndex out of range`);
  }
  const letters = ['a', 'b', 'c', 'd'];
  return {
    id: cardId,
    type: 'quiz',
    questionId,
    question,
    options: options.map((text, index) => ({ id: letters[index], text })),
    correctOptionId: letters[correctIndex],
    explanation,
  };
}

/** Structural rules every lesson must satisfy to be renderable. */
export function validateSyllabusLesson(cards: LessonCard[]): void {
  if (cards.length === 0) throw new Error('lesson has no cards');
  if (!cards.some((card) => card.type === 'quiz')) throw new Error('lesson has no quiz');
  if (cards[cards.length - 1].type !== 'summary') throw new Error('lesson must end with a summary');
  const ids = new Set<string>();
  const questionIds = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`duplicate card id "${card.id}"`);
    ids.add(card.id);
    if (card.type === 'quiz') {
      if (questionIds.has(card.questionId)) {
        throw new Error(`duplicate questionId "${card.questionId}"`);
      }
      questionIds.add(card.questionId);
      const optionIds = card.options.map((option) => option.id);
      if (new Set(optionIds).size !== optionIds.length) {
        throw new Error(`duplicate option ids in ${card.questionId}`);
      }
      if (!optionIds.includes(card.correctOptionId)) {
        throw new Error(`correct option missing in ${card.questionId}`);
      }
      if (card.question.trim().length === 0 || card.options.some((o) => o.text.trim().length === 0)) {
        throw new Error(`blank question/option in ${card.questionId}`);
      }
    }
  }
}

export const SUBJECT_LABEL_KEYS: Record<string, string> = {
  math: 'subject.math',
  science: 'subject.science',
  sst: 'subject.sst',
  english: 'subject.english',
  practice: 'subject.practice',
};

export const SUBJECTS: readonly string[] = ['math', 'science', 'sst', 'english'];
export const GRADES: readonly number[] = [8, 9, 10];