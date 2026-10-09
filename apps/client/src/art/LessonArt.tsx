/**
 * LessonArt — animated SVG scenes for lessons, one per subject.
 *
 * These are vector scenes animated with CSS, not bitmaps: no downloads, no
 * CDN, nothing to cache, crisp at any density, and they keep working with the
 * device fully offline. Every animation is switched off under
 * `prefers-reduced-motion` (see `art.css`).
 */

import { useMemo, type ReactElement } from 'react';
import type { SyllabusSubjectId } from '../db/schema';

export interface LessonArtProps {
  subject: SyllabusSubjectId;
  /** Varies the scene so a subject's lessons don't all look identical. */
  variant?: number;
  className?: string;
}

/** Deterministic pseudo-random in [0,1) from a lesson id — stable per lesson. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function LessonArt({ subject, variant = 0, className }: LessonArtProps) {
  const scene = useMemo(() => ART[subject] ?? ART.practice, [subject]);
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

        {scene(uid, variant)}
      </svg>
    </div>
  );
}

type Scene = (uid: string, variant: number) => ReactElement;

/* ------------------------------------------------------------------ Math */
const mathScene: Scene = (uid, variant) => {
  const shapes = [
    <circle key="c" cx="200" cy="86" r="30" fill="none" stroke={`url(#neon-${uid})`} strokeWidth="3" />,
    <rect key="r" x="178" y="60" width="44" height="44" fill="none" stroke={`url(#neon-${uid})`} strokeWidth="3" />,
    <path key="t" d="M200 52 L228 104 L172 104 Z" fill="none" stroke={`url(#neon-${uid})`} strokeWidth="3" />,
  ];
  return (
    <g>
      <g className="art-spin" style={{ transformOrigin: '200px 86px' }}>
        {shapes[variant % shapes.length]}
        {shapes[(variant + 1) % shapes.length]}
      </g>
      <g className="art-spin-slow" style={{ transformOrigin: '200px 86px' }}>
        <circle cx="200" cy="86" r="46" fill="none" stroke="#ff2d95" strokeWidth="1.5" strokeDasharray="6 10" />
      </g>
      <text x="200" y="96" textAnchor="middle" fontSize="30" fontWeight="800"
        fontStyle="italic" fill={`url(#chrome-${uid})`} className="art-pulse">
        {['π', '∑', '√', '∞', 'Δ'][variant % 5]}
      </text>
    </g>
  );
};

/* --------------------------------------------------------------- Science */
const scienceScene: Scene = (uid, variant) => (
  <g className="art-spin-slow" style={{ transformOrigin: '200px 86px' }}>
    <circle cx="200" cy="86" r="9" fill="#00e5ff" className="art-pulse" />
    <ellipse cx="200" cy="86" rx="46" ry="18" fill="none" stroke="#ff2d95" strokeWidth="2" />
    <ellipse cx="200" cy="86" rx="46" ry="18" fill="none" stroke="#00e5ff" strokeWidth="2"
      transform="rotate(60 200 86)" />
    <ellipse cx="200" cy="86" rx="46" ry="18" fill="none" stroke="#ffd166" strokeWidth="2"
      transform="rotate(120 200 86)" />
    <circle cx="246" cy="86" r="4" fill="#ff2d95" />
    <circle cx="177" cy="47" r="4" fill="#00e5ff" />
    <circle cx="177" cy="125" r="4" fill="#ffd166" />
  </g>
);

/* ------------------------------------------------------------------- SST */
const sstScene: Scene = (uid, variant) => (
  <g>
    {/* Neon skyline */}
    {Array.from({ length: 9 }, (_, i) => {
      const w = 26 + rand(i + variant * 3 + 1) * 22;
      const x = i * 46 - 8;
      const h = 26 + rand(i * 5 + variant * 7 + 2) * 58;
      return (
        <rect key={i} x={x} y={166 - h} width={w} height={h} fill="#12042e" stroke={`url(#neon-${uid})`} strokeWidth="1.2" />
      );
    })}
    <g className="art-twinkle" opacity="0.95">
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={20 + i * 30} y={92 + rand(i + variant) * 44} width="5" height="4"
          fill={i % 3 === 0 ? '#ff2d95' : '#00e5ff'} opacity="0.75" />
      ))}
    </g>
  </g>
);

/* --------------------------------------------------------------- English */
const englishScene: Scene = (uid, variant) => (
  <g>
    <g className="art-bob">
      {['A', 'B', 'C'][variant % 3] && (
        <text x="200" y="104" textAnchor="middle" fontSize="64" fontWeight="800"
          fontStyle="italic" fill={`url(#chrome-${uid})`}>
          {['A', 'B', 'C', 'R', 'S'][variant % 5]}
        </text>
      )}
    </g>
    <g opacity="0.9">
      {Array.from({ length: 6 }, (_, i) => (
        <text key={i} x={26 + i * 68} y={44 + rand(i + variant) * 22} fontSize="15" fontWeight="700"
          fontStyle="italic" fill="#00e5ff" opacity="0.75" className="art-drift"
          style={{ animationDelay: `${i * 0.5}s` }}>
          {['a', 'e', 'i', 'o', 'u', 'y'][i]}
        </text>
      ))}
    </g>
  </g>
);

/* --------------------------------------------------------------- Practice */
const practiceScene: Scene = (uid, variant) => (
  <g>
    <g className="art-spin-slow" style={{ transformOrigin: '200px 86px' }}>
      <polygon points={`200,40 ${40 + variant * 4},130 ${360 - variant * 4},130`}
        fill="none" stroke={`url(#neon-${uid})`} strokeWidth="3" />
    </g>
    <circle cx="200" cy="86" r="18" fill="none" stroke="#ff2d95" strokeWidth="2" className="art-pulse" />
  </g>
);

const ART: Record<SyllabusSubjectId, Scene> = {
  math: mathScene,
  science: scienceScene,
  sst: sstScene,
  english: englishScene,
  practice: practiceScene,
};