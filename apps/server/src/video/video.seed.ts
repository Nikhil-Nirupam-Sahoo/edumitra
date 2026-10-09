/**
 * Curated video lecture seed.
 *
 * Every entry pins a real, publicly available lecture from an open
 * educational source — NCERT (CBSE), BSE Odisha, CHSE Odisha and
 * ICSE — by its YouTube video id, so the app ships with genuine
 * content even before any API key is configured. We reference the
 * video (streaming via the YouTube player); we do not re-host it.
 *
 * Ids are stable slugs so re-seeding is idempotent. Thumbnails use
 * YouTube's already-compressed mqdefault frames (320×180), which
 * load fast on a classroom connection.
 */

import type { DbPort } from '../db/index.js';

export interface SeedVideo {
  id: string;
  title: string;
  boardId: string;
  classId: string;
  subject: string;
  youtubeId: string;
  sourceUrl: string;
  description: string;
  durationSec: number | null;
}

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export const SEED_VIDEOS: SeedVideo[] = [
  // --- NCERT / CBSE, Class 10 Science ---
  {
    id: 'cbse-10-science-life-processes',
    title: 'Life Processes (NCERT Class 10 Science)',
    boardId: 'CBSE',
    classId: 'class-10',
    subject: 'science',
    youtubeId: 'nO-N6MmQJ2M',
    sourceUrl: yt('nO-N6MmQJ2M'),
    description:
      'NCERT Class 10 Science — Life Processes: nutrition, respiration, transportation and excretion in living organisms.',
    durationSec: null,
  },
  {
    id: 'cbse-10-science-chemical-reactions',
    title: 'Chemical Reactions and Equations (Class 10 Science, Ch. 1)',
    boardId: 'CBSE',
    classId: 'class-10',
    subject: 'science',
    youtubeId: 'aWkVP_lk0DU',
    sourceUrl: yt('aWkVP_lk0DU'),
    description:
      'NCERT Class 10 Science Chapter 1 — Chemical Reactions and Equations, explained with animated examples.',
    durationSec: null,
  },
  {
    id: 'cbse-10-science-light',
    title: 'Light — Reflection and Refraction (Class 10 Science)',
    boardId: 'CBSE',
    classId: 'class-10',
    subject: 'science',
    youtubeId: 'OnX5Egr5ADw',
    sourceUrl: yt('OnX5Egr5ADw'),
    description:
      'Class 10 Science — Light: Reflection and Refraction, mirrors, lenses and the laws of refraction.',
    durationSec: null,
  },

  // --- BSE Odisha, Class 10 ---
  {
    id: 'bse-10-english-grain',
    title: "A Grain as Big as a Hen's Egg (Class 10 English, BSE Odisha)",
    boardId: 'BSE_ODISHA',
    classId: 'class-10',
    subject: 'english',
    youtubeId: 'mkVEaUDtxF4',
    sourceUrl: yt('mkVEaUDtxF4'),
    description:
      'BSE Odisha Class 10 English — non-detailed study: "A Grain as Big as a Hen\'s Egg" (Leo Tolstoy), read in Odia.',
    durationSec: null,
  },
  {
    id: 'bse-10-life-science-natural-resources',
    title: 'Natural Resources: Importance and Conservation (Class 10 Life Science)',
    boardId: 'BSE_ODISHA',
    classId: 'class-10',
    subject: 'science',
    youtubeId: '7F-lW3f8jaQ',
    sourceUrl: yt('7F-lW3f8jaQ'),
    description:
      'BSE Odisha Class 10 Life Science — Prakrutika Sampadara Gurutwa o Suparichalana (natural resources and conservation).',
    durationSec: null,
  },
  {
    id: 'bse-10-geography-bhugolo',
    title: 'Bhugolo — Geography Chapter 2 (Class 10, Odia medium)',
    boardId: 'BSE_ODISHA',
    classId: 'class-10',
    subject: 'sst',
    youtubeId: '63bP7ENoCuE',
    sourceUrl: yt('63bP7ENoCuE'),
    description:
      'BSE Odisha Class 10 Geography (Bhugolo), Odia medium — Chapter 2, Part 1.',
    durationSec: null,
  },

  // --- CHSE Odisha (Higher Secondary) ---
  {
    id: 'chse-maths-probability',
    title: 'Probability — Key Questions (CHSE Odisha)',
    boardId: 'CHSE',
    classId: 'class-12',
    subject: 'math',
    youtubeId: 'iAENrzVvhMs',
    sourceUrl: yt('iAENrzVvhMs'),
    description:
      'CHSE Odisha Mathematics — Probability, key questions and worked examples for the board exam.',
    durationSec: null,
  },
  {
    id: 'chse-history-gupta-juga',
    title: 'Gupta Juga (CHSE Odisha History, Class 12)',
    boardId: 'CHSE',
    classId: 'class-12',
    subject: 'sst',
    youtubeId: 'KUy2Yq60YBI',
    sourceUrl: yt('KUy2Yq60YBI'),
    description:
      'CHSE Odisha Plus Two History — the Gupta era (Gupta Juga), full chapter in Odia.',
    durationSec: null,
  },
  {
    id: 'chse-biology-revision',
    title: 'Biology Revision (CHSE Board Exam)',
    boardId: 'CHSE',
    classId: 'class-12',
    subject: 'science',
    youtubeId: 'GH9fXzA_D8g',
    sourceUrl: yt('GH9fXzA_D8g'),
    description:
      'CHSE Odisha — 12th Biology revision for the board exam.',
    durationSec: null,
  },

  // --- ICSE, Class 10 ---
  {
    id: 'icse-10-maths-ratio-proportion',
    title: 'Ratio and Proportion (ICSE Class 10 Maths)',
    boardId: 'ICSE',
    classId: 'class-10',
    subject: 'math',
    youtubeId: '5cFE7opEnmM',
    sourceUrl: yt('5cFE7opEnmM'),
    description:
      'ICSE Class 10 Mathematics — Ratio and Proportion: concepts, formulas and worked examples.',
    durationSec: null,
  },
  {
    id: 'icse-10-maths-polynomials',
    title: 'Factorisation of Polynomials (ICSE Class 10 Maths)',
    boardId: 'ICSE',
    classId: 'class-10',
    subject: 'math',
    youtubeId: 'DEP0UL_GT2E',
    sourceUrl: yt('DEP0UL_GT2E'),
    description:
      'ICSE Class 10 Mathematics — Factorisation of Polynomials, full video with board questions.',
    durationSec: null,
  },
  {
    id: 'icse-10-maths-syllabus',
    title: 'ICSE Class 10 Mathematics Syllabus',
    boardId: 'ICSE',
    classId: 'class-10',
    subject: 'math',
    youtubeId: 'lSlEAaIAxNM',
    sourceUrl: yt('lSlEAaIAxNM'),
    description:
      'ICSE Class 10 Mathematics — syllabus walkthrough and weightage for the board exam.',
    durationSec: null,
  },
];

/**
 * Inserts any missing seed videos. Existing rows are left untouched
 * so a teacher's edits (or a student's progress) survive a redeploy.
 */
export async function seedVideoLectures(db: DbPort): Promise<number> {
  let created = 0;
  const now = Date.now();
  for (const video of SEED_VIDEOS) {
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM video_lectures WHERE id = ?',
      [video.id],
    );
    if (existing) continue;
    await db.execute(
      `INSERT INTO video_lectures
         (id, lesson_id, topic_id, title, description, board_id, class_id,
          subject, source, source_url, youtube_id, duration_sec, thumbnail_webp,
          subtitles_json, languages_json, downloadable, created_at, updated_at)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'youtube', ?, ?, ?, ?, '[]', '[]', 1, ?, ?)`,
      [
        video.id,
        video.title,
        video.description,
        video.boardId,
        video.classId,
        video.subject,
        video.sourceUrl,
        video.youtubeId,
        video.durationSec,
        `https://i.ytimg.com/vi/${video.youtubeId}/mqdefault.jpg`,
        now,
        now,
      ],
    );
    created += 1;
  }
  return created;
}
