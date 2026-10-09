/**
 * LessonArt — the animated figure shown above a lesson.
 *
 * Two layers:
 *  - a topic figure from `figures.tsx` (Manim-style diagram chosen per lesson,
 *    e.g. a parabola for quadratic equations, a v–t graph for motion), and
 *  - the Vice City backdrop (starfield + slitted sunset + grid).
 *
 * Everything is vector + CSS: no downloads, crisp at any density, and it works
 * with the device fully offline. Animation stops under `prefers-reduced-motion`.
 */

import { useMemo, type ReactElement } from 'react';
import type { SyllabusSubjectId } from '../db/schema';
import { figureForLesson } from './figures';

export interface LessonArtProps {
  subject: SyllabusSubjectId;
  /** The lesson id — picks the topic-relevant figure. */
  lessonId?: string;
  /** Varies the backdrop so a subject's lessons don't all look identical. */
  variant?: number;
  className?: string;
}

/** Deterministic pseudo-random in [0,1) from a lesson id — stable per lesson. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function LessonArt({ subject, lessonId, variant = 0, className }: LessonArtProps) {
  const figure = useMemo(() => figureForLesson(lessonId), [lessonId]);
  const uid = `${subject}-${variant}`;

  return (
    <div className={`lesson-art art-${subject} ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#08021c" />
            <stop offset="55%" stopColor="#1b0b45" />
            <stop offset="100%" stopColor="#2d1060" />
          </linearGradient>
          <linearGradient id={`sun-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffc371" />
            <stop offset="45%" stopColor="#ff6b9d" />
            <stop offset="100%" stopColor="#f5007d" />
          </linearGradient>
          <linearGradient id={`neon-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#7b2ff7" />
          </linearGradient>
          <linearGradient id={`chrome-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="48%" stopColor="#7fb6ff" />
            <stop offset="52%" stopColor="#2b6fd6" />
            <stop offset="100%" stopColor="#d9f0ff" />
          </linearGradient>
        </defs>

        <rect width="400" height="200" fill={`url(#sky-${uid})`} />

        {/* Shared: stars + slitted sun */}
        <g className="art-stars">
          {Array.from({ length: 14 }, (_, i) => {
            const x = rand(i + variant * 7 + 1) * 400;
            const y = rand(i * 3 + variant * 11 + 5) * 90;
            const r = 0.8 + rand(i + 2) * 1.3;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={r}
                fill="#fff"
                opacity={0.35 + rand(i + 9) * 0.5}
                style={{ animationDelay: `${(i % 5) * 0.4}s` }}
              />
            );
          })}
        </g>
        <g>
          <circle cx="200" cy="150" r="62" fill={`url(#sun-${uid})`} opacity="0.85" />
          <g fill="#1b0b45" opacity="0.92">
            <rect x="120" y="150" width="160" height="3" />
            <rect x="120" y="160" width="160" height="5" />
            <rect x="120" y="172" width="160" height="7" />
            <rect x="120" y="186" width="160" height="10" />
          </g>
        </g>
        {/* Synthwave horizon grid */}
        <g stroke="#00e5ff" strokeWidth="0.8" opacity="0.35" fill="none">
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={166 + i * 7} x2="400" y2={166 + i * 7} />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`v${i}`} x1={200 + (i - 4) * 46} y1="166" x2={200 + (i - 4) * 96} y2="200" />
          ))}
        </g>
        {figure}
      </svg>
    </div>
  );
}

