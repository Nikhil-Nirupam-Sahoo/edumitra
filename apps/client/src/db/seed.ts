/**
 * Seed content — puts the syllabus on the device without any network access.
 *
 * The curriculum itself is DATA (`content/data/*.json`, described by its
 * manifest); this file only decides *when* to write it and with what version.
 *
 * Seeding is idempotent and incremental:
 *  - a fresh install gets every lesson;
 *  - an existing install only receives lessons that are missing, or whose
 *    bundled `contentVersion` is newer than the copy already on the device;
 *  - pre-existing (pre-syllabus) lessons are left untouched and shown under
 *    the Practice tab.
 */

import { getLessons, getAllStudents, upsertLessons, upsertStudents } from '../db/client';
import type { LessonRecord, StudentRecord } from '../db/schema';
import {
  CONTENT_VERSION,
  loadSyllabusLessons,
  validateSyllabusLesson,
  type SeedLesson,
} from '../content';

const SUBJECT_IDS = ['math', 'science', 'sst', 'english', 'practice'] as const;
const GRADE_IDS = [8, 9, 10] as const;

/** Convert one JSON lesson into a DB record (content serialized). */
export function toLessonRecord(seed: SeedLesson, contentVersion: number, updatedAt: number): LessonRecord {
  validateSyllabusLesson(seed.cards);
  const grade = (GRADE_IDS as readonly number[]).includes(seed.grade) ? (seed.grade as 8 | 9 | 10) : undefined;
  const subject = (SUBJECT_IDS as readonly string[]).includes(seed.subject)
    ? (seed.subject as (typeof SUBJECT_IDS)[number])
    : 'practice';
  return {
    id: seed.id,
    title: seed.title,
    language: 'en',
    version: contentVersion,
    content_json: JSON.stringify({
      version: contentVersion,
      language: 'en',
      cards: seed.cards,
    }),
    updated_at: updatedAt,
    grade,
    subject,
  };
}

/** Every bundled syllabus lesson, as DB records. */
export function buildSeedLessons(): LessonRecord[] {
  const now = Date.now();
  return loadSyllabusLessons().map((seed) => toLessonRecord(seed, CONTENT_VERSION, now));
}

export function buildSeedStudents(): StudentRecord[] {
  const now = Date.now();
  return [
    { id: 'student-aarav', name: 'Aarav', class_id: 'class-8-a', guardian_phone: null, created_at: now },
    { id: 'student-priya', name: 'Priya', class_id: 'class-8-a', guardian_phone: null, created_at: now },
    { id: 'student-rohan', name: 'Rohan', class_id: 'class-9-a', guardian_phone: null, created_at: now },
    { id: 'student-diasha', name: 'Diasha', class_id: 'class-9-a', guardian_phone: null, created_at: now },
    { id: 'student-kabir', name: 'Kabir', class_id: 'class-10-a', guardian_phone: null, created_at: now },
    { id: 'student-ananya', name: 'Ananya', class_id: 'class-10-a', guardian_phone: null, created_at: now },
  ];
}

/** Idempotent: safe to call on every app start. */
export async function seedIfEmpty(): Promise<void> {
  const [lessons, students] = await Promise.all([getLessons(), getAllStudents()]);
  const writes: Promise<void>[] = [];

  // Only write what this device is missing or has at an older content version.
  const present = new Map(lessons.map((lesson) => [lesson.id, lesson.version]));
  const now = Date.now();
  const missing = loadSyllabusLessons()
    .filter((seed) => {
      const installed = present.get(seed.id);
      return installed === undefined || installed < CONTENT_VERSION;
    })
    .map((seed) => toLessonRecord(seed, CONTENT_VERSION, now));

  if (missing.length > 0) {
    writes.push(upsertLessons(missing));
  }

  if (students.length === 0) {
    writes.push(upsertStudents(buildSeedStudents()));
  }
  await Promise.all(writes);
}