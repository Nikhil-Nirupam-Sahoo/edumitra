/**
 * Syllabus content model + compact builders.
 *
 * Every lesson is id-prefixed `c{grade}-{subject}-{slug}` so the grade and
 * subject are derivable without a schema migration, and the seeded records
 * also carry `grade`/`subject` fields directly. Lessons are plain
 * CARD + QUIZ + SUMMARY sequences — the same rendering path as any lesson.
 */

import type { LessonRecord, SyllabusGradeId, SyllabusSubjectId } from '../db/schema';
import type { LessonCard, QuizCard, SummaryCard, TextCard } from '../modules/lesson/lessonModel';

export type { SyllabusGradeId, SyllabusSubjectId };

export const SUBJECT_LABEL_KEYS: Record<SyllabusSubjectId, string> = {
  math: 'subject.math',
  science: 'subject.science',
  sst: 'subject.sst',
  english: 'subject.english',
  practice: 'subject.practice',
};

/** Reasonably early hour cards are rewarded (see gamification early_bird). */
export function textCard(id: string, title: string, body: string): TextCard {
  return { id, type: 'text', title, body };
}

export function summaryCard(id: string, body: string): SummaryCard {
  return { id, type: 'summary', title: '🌟', body };
}

/**
 * Quiz card; options get ids a/b/c/d and the correct one is derived by index.
 * `explanation` shows after answering, and is the "teach while they tap" hook.
 */
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

/** Lessons must follow the syllabus card mix: ≥ 1 quiz, ending on a summary. */
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
      if (questionIds.has(card.questionId)) throw new Error(`duplicate questionId "${card.questionId}"`);
      questionIds.add(card.questionId);
      const optionIds = card.options.map((option) => option.id);
      if (new Set(optionIds).size !== optionIds.length) throw new Error(`duplicate option ids in ${card.questionId}`);
      if (!optionIds.includes(card.correctOptionId)) throw new Error(`correct option missing in ${card.questionId}`);
      if (card.question.trim().length === 0 || card.options.some((o) => o.text.trim().length === 0)) {
        throw new Error(`blank question/option in ${card.questionId}`);
      }
    }
  }
}

export interface SeedLesson {
  id: string;
  title: string;
  grade: SyllabusGradeId;
  subject: SyllabusSubjectId;
  cards: LessonCard[];
}

/** Convert a structured seed lesson into a DB record (content serialized). */
export function toLessonRecord(seed: SeedLesson, contentVersion: number, updatedAt: number): LessonRecord {
  validateSyllabusLesson(seed.cards);
  return {
    id: seed.id,
    title: seed.title,
    language: 'en',
    version: contentVersion,
    content_json: JSON.stringify({ version: contentVersion, language: 'en', cards: seed.cards }),
    updated_at: updatedAt,
    grade: seed.grade,
    subject: seed.subject,
  };
}

export const SUBJECTS: readonly SyllabusSubjectId[] = ['math', 'science', 'sst', 'english'];
export const GRADES: readonly SyllabusGradeId[] = [8, 9, 10];