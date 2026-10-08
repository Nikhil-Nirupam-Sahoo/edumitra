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
import type { LessonContent } from '../modules/lesson/lessonModel';
import type { LessonRecord, StudentRecord } from '../db/schema';

const INLINE_SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#e0ecff"/>
      <circle cx="320" cy="150" r="70" fill="#1d4ed8"/>
      <text x="320" y="290" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#1e3a8a">Fractions</text>
    </svg>`,
  );

function lesson(
  id: string,
  title: string,
  language: string,
  version: number,
  content: LessonContent,
): LessonRecord {
  return {
    id,
    title,
    language,
    version,
    content_json: JSON.stringify(content),
    updated_at: Date.now(),
  };
}

export function buildSeedLessons(): LessonRecord[] {
  return [
    lesson('math-fractions-1', 'Understanding Fractions', 'en', 1, {
      version: 1,
      language: 'en',
      auId: 'au:math-fractions-1',
      cards: [
        {
          id: 'c1',
          type: 'text',
          title: 'What is a fraction?',
          body: 'A fraction shows a part of a whole. If a roti is cut into 4 equal pieces, each piece is one-fourth (1/4).',
          audioCue: 'audio/en/math-fractions-1/c1.mp3',
        },
        {
          id: 'c2',
          type: 'image',
          title: 'One whole, four parts',
          imageUrl: INLINE_SAMPLE_IMAGE,
          width: 640,
          height: 360,
          caption: 'One whole divided into four equal parts',
          audioCue: 'audio/en/math-fractions-1/c2.mp3',
        },
        {
          id: 'c3',
          type: 'audio',
          title: 'Listen and repeat',
          audioUrl: 'audio/en/math-fractions-1/c3.mp3',
          transcript: 'One half equals two fourths. One half equals two fourths.',
          audioCue: 'audio/en/math-fractions-1/c3.mp3',
        },
        {
          id: 'c4',
          type: 'quiz',
          title: 'Quick check',
          questionId: 'q1',
          question: 'You cut a roti into 4 equal pieces and eat 2. What fraction did you eat?',
          options: [
            { id: 'a', text: '1/4' },
            { id: 'b', text: '2/4' },
            { id: 'c', text: '4/2' },
          ],
          correctOptionId: 'b',
          explanation: 'You ate 2 of 4 equal pieces, which is 2/4 — the same as one half.',
          audioCue: 'audio/en/math-fractions-1/c4.mp3',
        },
        {
          id: 'c5',
          type: 'quiz',
          title: 'One more',
          questionId: 'q2',
          question: 'Which fraction is equal to one half?',
          options: [
            { id: 'a', text: '3/4' },
            { id: 'b', text: '1/3' },
            { id: 'c', text: '2/4' },
          ],
          correctOptionId: 'c',
          explanation: '2/4 simplifies to 1/2.',
        },
        {
          id: 'c6',
          type: 'summary',
          title: 'Well done!',
          body: 'A fraction is a part of a whole. Equal parts have equal fractions.',
        },
      ],
    }),
    lesson('sci-water-cycle-1', 'The Water Cycle', 'en', 1, {
      version: 1,
      language: 'en',
      auId: 'au:sci-water-cycle-1',
      cards: [
        {
          id: 'w1',
          type: 'text',
          title: 'Water moves in a circle',
          body: 'Water evaporates from rivers and oceans, forms clouds, falls as rain, and flows back. This never stops.',
          audioCue: 'audio/en/sci-water-cycle-1/w1.mp3',
        },
        {
          id: 'w2',
          type: 'quiz',
          title: 'Quick check',
          questionId: 'wq1',
          question: 'What is it called when water rises as vapour?',
          options: [
            { id: 'a', text: 'Condensation' },
            { id: 'b', text: 'Evaporation' },
            { id: 'c', text: 'Precipitation' },
          ],
          correctOptionId: 'b',
          explanation: 'Liquid water becomes vapour in evaporation.',
        },
        {
          id: 'w3',
          type: 'summary',
          title: 'Well done!',
          body: 'Evaporation → condensation → precipitation → collection.',
        },
      ],
    }),
    lesson('math-fractions-1-hi', 'भिन्न को समझें', 'hi', 1, {
      version: 1,
      language: 'hi',
      auId: 'au:math-fractions-1-hi',
      cards: [
        {
          id: 'h1',
          type: 'text',
          title: 'भिन्न क्या है?',
          body: 'भिन्न पूरे का एक हिस्सा दिखाती है। अगर रोटी को 4 बराबर टुकड़ों में काटें, तो हर टुकड़ा एक-चौथाई (1/4) है।',
          audioCue: 'audio/hi/math-fractions-1/h1.mp3',
        },
        {
          id: 'h2',
          type: 'quiz',
          title: 'जाँच करें',
          questionId: 'hq1',
          question: 'रोटी के 4 बराबर टुकड़ों में से 2 खाए। कितना हिस्सा खाया?',
          options: [
            { id: 'a', text: '1/4' },
            { id: 'b', text: '2/4' },
            { id: 'c', text: '4/2' },
          ],
          correctOptionId: 'b',
          explanation: '4 में से 2 हिस्से यानी 2/4 — जो आधे के बराबर है।',
        },
        {
          id: 'h3',
          type: 'summary',
          title: 'शाबाश!',
          body: 'भिन्न पूरे का हिस्सा है। बराबर हिस्सों की भिन्न बराबर होती है।',
        },
      ],
    }),
  ];
}

export function buildSeedStudents(): StudentRecord[] {
  const now = Date.now();
  return [
    { id: 'student-asha', name: 'Asha Kumari', class_id: 'grade-5-a', guardian_phone: null, created_at: now },
    { id: 'student-ravi', name: 'Ravi Prasad', class_id: 'grade-5-a', guardian_phone: null, created_at: now },
    { id: 'student-meena', name: 'Meena Devi', class_id: 'grade-5-a', guardian_phone: null, created_at: now },
    { id: 'student-arjun', name: 'Arjun Singh', class_id: 'grade-5-a', guardian_phone: null, created_at: now },
    { id: 'student-fatima', name: 'Fatima Begum', class_id: 'grade-5-b', guardian_phone: null, created_at: now },
  ];
}

/** Idempotent: safe to call on every app start. */
export async function seedIfEmpty(): Promise<void> {
  const { getLessons, getAllStudents } = await import('../db/client');
  const [lessons, students] = await Promise.all([getLessons(), getAllStudents()]);
  const writes: Promise<void>[] = [];
  if (lessons.length === 0) {
    writes.push(upsertLessons(buildSeedLessons()));
  }
  if (students.length === 0) {
    writes.push(upsertStudents(buildSeedStudents()));
  }
  await Promise.all(writes);
}
