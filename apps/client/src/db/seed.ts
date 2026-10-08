/**
 * Seed content — ships with the app build so a freshly installed device has
 * lessons WITHOUT any network access. In production this is replaced by the
 * delta lesson downloader (`content.json` → upsertLessons); the seeding path
 * is identical, which keeps the demo honest.
 *
 * Media references point at /media/ (WebP + short compressed audio). The seed
 * lessons intentionally use tiny inline SVG data-URI images so the demo works
 * with zero downloaded assets.
 */

import { upsertLessons, upsertStudents } from '../db/client';
import type { LessonRecord, StudentRecord } from '../db/schema';
import { CLASS_8_LESSONS } from '../content/class8';
import { CLASS_9_LESSONS } from '../content/class9';
import { CLASS_10_LESSONS } from '../content/class10';
import { toLessonRecord, type SeedLesson } from '../content/types';

const SYLLABUS_LESSONS: SeedLesson[] = [
  ...CLASS_8_LESSONS,
  ...CLASS_9_LESSONS,
  ...CLASS_10_LESSONS,
];

function syllabusSeedVersion(): number {
  return 1;
}

function syllabusIds(): string[] {
  return SYLLABUS_LESSONS.map((l) => l.id);
}

export function buildSeedLessons(): LessonRecord[] {
  const now = Date.now();
  const ver = syllabusSeedVersion();
  return SYLLABUS_LESSONS.map((seed) => toLessonRecord(seed, ver, now));
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
  const { getLessons, getAllStudents } = await import('../db/client');
  const [lessons, students] = await Promise.all([getLessons(), getAllStudents()]);
  const writes: Promise<void>[] = [];

  // Always ensure syllabus lessons are present (missing ones get upserted)
  const present = new Set(lessons.map((l) => l.id));
  const missing = SYLLABUS_LESSONS.filter((l) => !present.has(l.id));
  if (missing.length > 0) {
    const ver = syllabusSeedVersion();
    const records = missing.map((seed) => toLessonRecord(seed, ver, Date.now()));
    writes.push(upsertLessons(records));
  }

  if (students.length === 0) {
    writes.push(upsertStudents(buildSeedStudents()));
  }
  await Promise.all(writes);
}
