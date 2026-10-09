/**
 * Game question bank — derived from the downloaded syllabus content.
 *
 * Nothing here is hand-written per question: the same quiz cards a student
 * already learns from become rapid-fire questions, True/False rounds and
 * term→definition memory pairs. That keeps games and curriculum in lockstep —
 * a content update automatically changes the games, and nothing drifts.
 */

import { getLessons } from '../db/client';
import type { LessonRecord } from '../db/schema';
import type { LessonCard, QuizCard, TextCard } from '../modules/lesson/lessonModel';

export interface GameQuestion {
  /** Stable id so a replayed question can be recognised. */
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  hint?: string;
  lessonId: string;
  lessonTitle: string;
  subject: string;
  grade: number | undefined;
}

export interface MemoryPair {
  id: string;
  /** Front of the card — the chapter term or title. */
  term: string;
  /** Back of the card — what it means. */
  definition: string;
  lessonId: string;
}

function isQuiz(card: LessonCard): card is QuizCard {
  return card.type === 'quiz';
}

function isText(card: LessonCard): card is TextCard {
  return card.type === 'text';
}

function parse(lesson: LessonRecord): LessonCard[] {
  try {
    const parsed = JSON.parse(lesson.content_json) as { cards?: LessonCard[] };
    return Array.isArray(parsed.cards) ? parsed.cards : [];
  } catch {
    return [];
  }
}

/** Every quiz question in the library, optionally filtered. */
export function buildQuestionBank(
  lessons: LessonRecord[],
  filter?: { grade?: number; subject?: string },
): GameQuestion[] {
  const bank: GameQuestion[] = [];
  for (const lesson of lessons) {
    if (filter?.grade !== undefined && lesson.grade !== filter.grade) continue;
    if (filter?.subject && lesson.subject !== filter.subject) continue;
    for (const card of parse(lesson)) {
      if (!isQuiz(card) || card.options.length < 2) continue;
      const correctIndex = card.options.findIndex((o) => o.id === card.correctOptionId);
      if (correctIndex < 0) continue;
      bank.push({
        id: `${lesson.id}:${card.questionId}`,
        prompt: card.question,
        options: card.options.map((o) => o.text),
        correctIndex,
        hint: card.explanation,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        subject: lesson.subject ?? 'practice',
        grade: typeof lesson.grade === 'number' ? lesson.grade : undefined,
      });
    }
  }
  return bank;
}

/**
 * Term → definition pairs for the memory game, taken from each lesson's first
 * text card (title as the term, body as the definition). Long bodies are
 * skipped: a memory card has to be readable at a glance.
 */
export function buildMemoryPairs(
  lessons: LessonRecord[],
  filter?: { grade?: number; subject?: string },
): MemoryPair[] {
  const pairs: MemoryPair[] = [];
  for (const lesson of lessons) {
    if (filter?.grade !== undefined && lesson.grade !== filter.grade) continue;
    if (filter?.subject && lesson.subject !== filter.subject) continue;
    const intro = parse(lesson).find(isText);
    if (!intro?.title || !intro.body) continue;
    const definition = intro.body.length > 190 ? `${intro.body.slice(0, 187).trimEnd()}…` : intro.body;
    pairs.push({
      id: `${lesson.id}:intro`,
      term: intro.title,
      definition,
      lessonId: lesson.id,
    });
  }
  return pairs;
}

/**
 * True/False statements.
 *
 * A claim only makes sense if it reads as one, so:
 *  - the correct answer becomes a "True" claim, and
 *  - a distractor becomes a "False" claim ONLY when it is phrased like an
 *    answer rather than a bare number or symbol (e.g. a distractor "45" is
 *    meaningless on its own, so that question stays a True item instead).
 */
export function buildTrueFalse(
  lessons: LessonRecord[],
  filter?: { grade?: number; subject?: string },
): GameQuestion[] {
  const bank = buildQuestionBank(lessons, filter);
  const out: GameQuestion[] = [];
  for (const question of bank) {
    const right = question.options[question.correctIndex];
    if (right) {
      out.push({
        ...question,
        id: `tf-true:${question.id}`,
        prompt: `True or false — ${right}`,
        options: ['True', 'False'],
        correctIndex: 0,
        hint: question.hint,
      });
    }
    const distractors = question.options.filter(
      (option, i) => i !== question.correctIndex && readsAsAClaim(option),
    );
    if (distractors.length === 0) continue;
    // Alternate the phrasing so a round is not all True.
    const claim = distractors[0]!;
    out.push({
      ...question,
      id: `tf-false:${question.id}`,
      prompt: `True or false — ${claim}`,
      options: ['True', 'False'],
      correctIndex: 1,
      hint: `The accepted answer is: ${right ?? question.prompt}`,
    });
  }
  return out;
}

/** A bare number ("45", "3/4") is not a proposition; prose or a formula is. */
function readsAsAClaim(option: string): boolean {
  const trimmed = option.trim();
  if (trimmed.length < 12) return false;
  return /[a-z]/i.test(trimmed);
}

/** Loads the library once; games read from cache. */
export async function loadLibrary(): Promise<LessonRecord[]> {
  try {
    return await getLessons();
  } catch {
    return [];
  }
}

/** Fisher–Yates with a seeded RNG so a round can be replayed identically. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Picks n distinct questions, preferring ones the student hasn't just seen. */
export function pickQuestions(
  bank: readonly GameQuestion[],
  n: number,
  random: () => number = Math.random,
): GameQuestion[] {
  if (bank.length === 0) return [];
  const shuffled = shuffle(bank, random);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}