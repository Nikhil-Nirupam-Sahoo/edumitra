/**
 * Topic figures — Manim-style animated diagrams, one per chapter.
 *
 * Manim's visual language: a dark stage, clean bright strokes, labelled axes
 * and points, right-angle marks, and the decisive detail — figures that are
 * *drawn* rather than faded in (stroke-dashoffset) and objects that move
 * (dash-offset or transform). Colours stay on the app's Vice City neon palette
 * so it reads as one product.
 *
 * Every figure is a pure SVG scene driven by CSS keyframes in `art.css`, so it
 * is offline, resolution-independent, and inert under `prefers-reduced-motion`.
 *
 * To add a chapter figure: write a scene, register it in FIGURES, and point the
 * lesson at it in LESSON_FIGURES.
 */

import type { ReactElement, ReactNode } from 'react';

const CYAN = '#00e5ff';
const PINK = '#ff2d95';
const AMBER = '#ffd166';
const LIME = '#7cf03d';
const PURPLE = '#b388ff';
const WHITE = '#eaf6ff';

/* -------------------------------------------------------------------------- */
/* Drawing primitives                                                          */
/* -------------------------------------------------------------------------- */

const VIEW_W = 400;
const VIEW_H = 200;

/** A path/line that draws itself on, like Manim's `Create`. */
function Draw({
  d,
  delay = 0,
  dur = 1.1,
  stroke = CYAN,
  width = 2.2,
  fill = 'none',
  dashed = false,
}: {
  d: string;
  delay?: number;
  dur?: number;
  stroke?: string;
  width?: number;
  fill?: string;
  /** Dashed guide lines (axis of symmetry, construction lines). */
  dashed?: boolean;
}) {
  return (
    <path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Guides stay dashed; solid strokes animate their draw-on.
      strokeDasharray={dashed ? '5 4' : undefined}
      pathLength={dashed ? undefined : 1}
      className={dashed ? undefined : 'fig-draw'}
      style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }}
    />
  );
}

/** A shape that fades/rises in, like Manim's `FadeIn`. */
function Fade({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  return (
    <g className="fig-fade" style={{ animationDelay: `${delay}s` }}>
      {children}
    </g>
  );
}

/** Point that travels along a path, like Manim's `MoveAlongPath`. */
function Mover({
  path,
  dur = 3,
  delay = 0,
  color = AMBER,
  r = 4,
}: {
  path: string;
  dur?: number;
  delay?: number;
  color?: string;
  r?: number;
}) {
  return (
    <path d={path} fill="none" stroke="none" pathLength={1} className="fig-mover-track" data-dur={dur} data-delay={delay} id={`mv-${Math.abs(hash(path))}-${dur}-${delay}`} />
  );
}

/** Small label. Manim labels are compact and monospaced-ish. */
function Label({
  x,
  y,
  children,
  size = 11,
  fill = WHITE,
  delay = 0.6,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  fill?: string;
  delay?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill={fill}
      textAnchor={anchor}
      className="fig-fade"
      style={{ animationDelay: `${delay}s` }}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
    >
      {children}
    </text>
  );
}

/** Right-angle marker, as Manim draws at a corner. */
function RightAngle({ x, y, s = 9, delay = 0.8 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <Fade delay={delay}>
      <path
        d={`M ${x} ${y + s} L ${x + s} ${y + s} L ${x + s} ${y}`}
        fill="none"
        stroke={WHITE}
        strokeWidth={1.6}
      />
    </Fade>
  );
}

/** Cartesian axes with ticks. */
function Axes({
  x0 = 40,
  y0 = 150,
  w = 330,
  h = 120,
  delay = 0,
  ticksX = 6,
  ticksY = 4,
}: {
  x0?: number;
  y0?: number;
  w?: number;
  h?: number;
  delay?: number;
  ticksX?: number;
  ticksY?: number;
}) {
  return (
    <g>
      <Draw d={`M ${x0} ${y0} L ${x0 + w} ${y0}`} delay={delay} stroke={WHITE} width={1.6} />
      <Draw d={`M ${x0} ${y0} L ${x0} ${y0 - h}`} delay={delay + 0.15} stroke={WHITE} width={1.6} />
      <Fade delay={delay + 0.5}>
        {[...Array(ticksX)].map((_, i) => (
          <line
            key={`tx${i}`}
            x1={x0 + ((w / ticksX) * (i + 1))}
            y1={y0 - 3}
            x2={x0 + ((w / ticksX) * (i + 1))}
            y2={y0 + 3}
            stroke={WHITE}
            strokeWidth={1}
          />
        ))}
        {[...Array(ticksY)].map((_, i) => (
          <line
            key={`ty${i}`}
            x1={x0 - 3}
            y1={y0 - (h / ticksY) * (i + 1)}
            x2={x0 + 3}
            y2={y0 - (h / ticksY) * (i + 1)}
            stroke={WHITE}
            strokeWidth={1}
          />
        ))}
        <text x={x0 + w + 6} y={y0 + 4} fontSize={11} fill={WHITE} fontFamily="ui-monospace, monospace">
          x
        </text>
        <text x={x0 - 4} y={y0 - h - 6} fontSize={11} fill={WHITE} fontFamily="ui-monospace, monospace">
          y
        </text>
      </Fade>
    </g>
  );
}

/** Plot a curve y=f(x) across the axes box. */
function Curve({
  f,
  x0,
  y0,
  w,
  h,
  xMin,
  xMax,
  yMin,
  yMax,
  color = PINK,
  delay = 0.5,
  dur = 1.8,
}: {
  f: (x: number) => number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  color?: string;
  delay?: number;
  dur?: number;
}) {
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const xv = xMin + ((xMax - xMin) * i) / 120;
    const yv = f(xv);
    const sx = x0 + ((xv - xMin) / (xMax - xMin)) * w;
    const sy = y0 - ((yv - yMin) / (yMax - yMin)) * h;
    pts.push(`${sx.toFixed(2)},${sy.toFixed(2)}`);
  }
  return (
    <Draw
      d={`M ${pts.join(' L ')}`}
      delay={delay}
      dur={dur}
      stroke={color}
      width={2.6}
    />
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** A dot that moves along `path` using CSS offset-path-free dash technique. */
function TravellingDot({
  d,
  delay = 1.4,
  dur = 3,
  color = AMBER,
  r = 4.5,
}: {
  d: string;
  delay?: number;
  dur?: number;
  color?: string;
  r?: number;
}) {
  // Rendered as a circle whose position is animated by motion-path when the
  // browser supports it; otherwise it simply appears at the start point.
  return (
    <g
      className="fig-travel"
      style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s`, ['--fig-path' as string]: `path('${d}')` }}
    >
      <circle cx="0" cy="0" r={r} fill={color} />
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Figures — one per chapter                                                   */
/* -------------------------------------------------------------------------- */

/** y = x² : roots, vertex, axis of symmetry. */
const parabola: ReactNode = (
  <g key="parabola">
    <Axes x0={60} y0={150} w={300} h={130} />
    <Curve f={(x) => x * x} x0={60} y0={150} w={300} h={130} xMin={-2.2} xMax={2.2} yMin={-0.6} yMax={4.8} color={PINK} />
    <Fade delay={1.9}>
      <circle cx={165} cy={150} r={5} fill={AMBER} />
      <circle cx={255} cy={150} r={5} fill={AMBER} />
      <circle cx={210} cy={62} r={5} fill={LIME} />
      <line x1={210} y1={28} x2={210} y2={150} stroke={LIME} strokeWidth={1} strokeDasharray="4 4" />
    </Fade>
    <Label x={163} y={166} delay={2.1}>{'x₁'}</Label>
    <Label x={257} y={166} delay={2.1}>{'x₂'}</Label>
    <Label x={214} y={58} delay={2.2} fill={LIME}>{'vertex'}</Label>
    <Label x={44} y={186} size={10} delay={2.3}>{'y = x²'}</Label>
  </g>
);

/** y = x³ : an S-shaped cubic. */
const cubic: ReactNode = (
  <g key="cubic">
    <Axes x0={60} y0={110} w={300} h={110} />
    <Curve f={(x) => Math.pow(x, 3) / 3} x0={60} y0={110} w={300} h={110} xMin={-2.4} xMax={2.4} yMin={-4.4} yMax={4.4} color={PINK} />
    <Fade delay={2}>
      <circle cx={200} cy={110} r={5} fill={AMBER} />
      <circle cx={172} cy={93} r={4} fill={CYAN} />
    </Fade>
    <Label x={204} y={116} delay={2.2}>{'origin'}</Label>
    <Label x={44} y={186} size={10} delay={2.3}>{'y = x³'}</Label>
  </g>
);

/** v–t graph with the shaded area (impulse), as drawn in motion lessons. */
const velocityTime: ReactNode = (
  <g key="vtime">
    <Axes x0={55} y0={150} w={310} h={125} />
    <Fade delay={0.5}>
      <polygon points="55,150 120,70 120,150" fill={AMBER} opacity={0.18} />
    </Fade>
    <Draw d="M 55 150 L 120 70" delay={0.6} stroke={CYAN} width={2.6} />
    <TravellingDot d="M 55 150 L 120 70" delay={1} dur={2.4} color={AMBER} />
    <Fade delay={2}>
      <circle cx={120} cy={70} r={4.5} fill={PINK} />
    </Fade>
    <Label x={126} y={68} fill={PINK} delay={2.2}>{'v'}</Label>
    <Label x={118} y={164} delay={2.2}>{'t'}</Label>
    <Label x={150} y={128} size={10} delay={2.4} fill={AMBER}>{'area = impulse'}</Label>
  </g>
);

/** Trapezium split into a triangle + rectangle (mensuration). */
const trapezoid: ReactNode = (
  <g key="trapezoid">
    <Draw d="M 90 140 L 150 60 L 310 60 L 330 140 Z" delay={0.2} stroke={CYAN} width={2.6} />
    <Draw d="M 90 140 L 330 140" delay={0.9} stroke={WHITE} width={1.2} dashed />
    <RightAngle x={150} y={140} delay={1.1} />
    <Fade delay={1.3}>
      <line x1={220} y1={60} x2={220} y2={140} stroke={PINK} strokeWidth={1.6} strokeDasharray="5 4" />
    </Fade>
    <Label x={210} y={78} fill={PINK} delay={1.6}>{'h'}</Label>
    <Label x={112} y={158} delay={1.5}>{'a'}</Label>
    <Label x={322} y={158} delay={1.5}>{'b'}</Label>
    <Label x={200} y={180} size={11} fill={AMBER} delay={1.8}>{'Area = ½(a + b)h'}</Label>
  </g>
);

/** Right triangle with angle A — trigonometry. */
const rightTriangle: ReactNode = (
  <g key="trig">
    <Draw d="M 80 150 L 80 50 L 300 150 Z" delay={0.2} stroke={CYAN} width={2.6} />
    <RightAngle x={80} y={150} delay={0.8} />
    <Fade delay={1.2}>
      <path d="M 140 150 A 60 60 0 0 0 126 126" fill="none" stroke={AMBER} strokeWidth={2} />
    </Fade>
    <Label x={132} y={134} fill={AMBER} delay={1.5}>{'A'}</Label>
    <Label x={74} y={98} delay={1.5}>{'opp'}</Label>
    <Label x={185} y={163} delay={1.5}>{'adj'}</Label>
    <Label x={196} y={96} delay={1.5}>{'hyp'}</Label>
    <Label x={250} y={186} size={11} fill={PINK} delay={1.8}>{'sin A = opp/hyp'}</Label>
  </g>
);

/** Number line with a common-multiple strip (HCF / LCM). */
const numberLine: ReactNode = (
  <g key="numberline">
    <Draw d="M 40 120 L 360 120" delay={0.1} stroke={WHITE} width={1.8} />
    <Fade delay={0.5}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <g key={i}>
          <line x1={40 + i * 40} y1={114} x2={40 + i * 40} y2={126} stroke={WHITE} strokeWidth={1.4} />
          <text x={40 + i * 40} y={142} fontSize={10} fill={WHITE} textAnchor="middle" fontFamily="ui-monospace, monospace">
            {i * 6}
          </text>
        </g>
      ))}
    </Fade>
    <Draw d="M 40 90 L 200 90" delay={0.9} stroke={AMBER} width={3} />
    <Draw d="M 200 60 L 360 60" delay={1.4} stroke={PINK} width={3} />
    <Label x={120} y={82} size={10} fill={AMBER} delay={1.7}>{'6×2'}</Label>
    <Label x={280} y={52} size={10} fill={PINK} delay={2}>{'12×2'}</Label>
    <Fade delay={2.2}>
      <circle cx={200} cy={120} r={5} fill={LIME} />
    </Fade>
    <Label x={196} y={164} fill={LIME} delay={2.4}>{'LCM'}</Label>
  </g>
);

/** Balance scale — linear equations (keep both sides equal). */
const balance: ReactNode = (
  <g key="balance">
    <Draw d="M 200 60 L 200 140" delay={0.1} stroke={WHITE} width={2.4} />
    <Draw d="M 140 160 L 260 160" delay={0.4} stroke={WHITE} width={2.4} />
    <Draw d="M 100 84 L 300 84" delay={0.7} stroke={CYAN} width={2.4} />
    <Draw d="M 200 60 L 200 84" delay={0.9} stroke={CYAN} width={2} />
    <Fade delay={1.2}>
      <circle cx={100} cy={84} r={4} fill={PINK} />
      <circle cx={300} cy={84} r={4} fill={PINK} />
      <rect x={86} y={88} width={28} height={18} fill="none" stroke={PINK} strokeWidth={1.8} />
      <rect x={286} y={88} width={28} height={18} fill="none" stroke={PINK} strokeWidth={1.8} />
    </Fade>
    <Label x={100} y={122} size={10} delay={1.6}>{'2x+3'}</Label>
    <Label x={300} y={122} size={10} delay={1.6}>{'9'}</Label>
    <TravellingDot d="M 240 160 L 160 160" delay={1.8} dur={2.6} color={AMBER} />
    <Label x={200} y={184} size={11} fill={AMBER} delay={2.4}>{'both sides stay equal'}</Label>
  </g>
);

/** Atom: nucleus plus three electron orbits. */
const atom: ReactNode = (
  <g key="atom">
    <g className="fig-spin-slow">
      <ellipse cx={200} cy={100} rx={92} ry={32} fill="none" stroke={CYAN} strokeWidth={1.6} opacity={0.8} />
      <ellipse cx={200} cy={100} rx={92} ry={32} fill="none" stroke={PINK} strokeWidth={1.6} opacity={0.8} transform="rotate(60 200 100)" />
      <ellipse cx={200} cy={100} rx={92} ry={32} fill="none" stroke={AMBER} strokeWidth={1.6} opacity={0.8} transform="rotate(120 200 100)" />
    </g>
    <Fade delay={0.2}>
      <circle cx={200} cy={100} r={14} fill={PINK} />
      <text x={200} y={105} fontSize={11} fill="#1c0c42" textAnchor="middle" fontFamily="ui-monospace, monospace">n</text>
    </Fade>
    <g className="fig-orbit">
      <circle cx={292} cy={100} r={5} fill={AMBER} />
    </g>
    <g className="fig-orbit-b">
      <circle cx={254} cy={48} r={5} fill={CYAN} />
    </g>
    <g className="fig-orbit-c">
      <circle cx={146} cy={152} r={5} fill={LIME} />
    </g>
    <Label x={200} y={178} size={11} delay={1.4} fill={WHITE}>{'electrons orbit the nucleus'}</Label>
  </g>
);

/** Ray diagram: reflection off a plane mirror. */
const reflection: ReactNode = (
  <g key="reflection">
    <Draw d="M 60 160 L 340 160" delay={0.1} stroke={WHITE} width={2.4} />
    <Fade delay={0.5}>
      {[...Array(9)].map((_, i) => (
        <line key={i} x1={70 + i * 32} y1={162} x2={54 + i * 32} y2={184} stroke={WHITE} strokeWidth={1} opacity={0.5} />
      ))}
    </Fade>
    <Draw d="M 200 160 L 90 40" delay={0.8} stroke={AMBER} width={2.6} />
    <Draw d="M 200 160 L 310 40" delay={1.5} stroke={CYAN} width={2.6} />
    <TravellingDot d="M 90 40 L 200 160" delay={1} dur={2} color={AMBER} />
    <TravellingDot d="M 200 160 L 310 40" delay={1.7} dur={2} color={CYAN} />
    <RightAngle x={200} y={160} s={10} delay={1.2} />
    <Fade delay={2}>
      <path d="M 175 133 A 25 25 0 0 0 175 115" fill="none" stroke={PINK} strokeWidth={1.8} />
      <path d="M 225 133 A 25 25 0 0 1 225 115" fill="none" stroke={PINK} strokeWidth={1.8} />
    </Fade>
    <Label x={168} y={118} size={10} fill={PINK} delay={2.3}>{'i'}</Label>
    <Label x={232} y={118} size={10} fill={PINK} delay={2.3}>{'r'}</Label>
    <Label x={300} y={182} size={10} delay={2.2}>{'mirror'}</Label>
    <Label x={130} y={34} size={10} fill={AMBER} delay={2.1}>{'incoming'}</Label>
    <Label x={250} y={34} size={10} fill={CYAN} delay={2.4}>{'reflected'}</Label>
  </g>
);

/** Circuit: battery, resistor, moving current. */
const circuit: ReactNode = (
  <g key="circuit">
    <Draw d="M 90 60 L 90 140 L 310 140 L 310 60 Z" delay={0.1} stroke={WHITE} width={2} />
    <Fade delay={0.7}>
      {[...Array(6)].map((_, i) => (
        <line key={i} x1={150 + i * 26} y1={140} x2={150 + i * 26} y2={140} stroke={CYAN} strokeWidth={3} opacity={0.9} />
      ))}
    </Fade>
    <Fade delay={1}>
      <rect x={112} y={92} width={16} height={40} fill="none" stroke={PINK} strokeWidth={2} />
      <text x={120} y={86} fontSize={12} fill={PINK} textAnchor="middle" fontFamily="ui-monospace, monospace">+</text>
      <text x={120} y={146} fontSize={12} fill={PINK} textAnchor="middle" fontFamily="ui-monospace, monospace">−</text>
    </Fade>
    <Draw d="M 220 140 L 220 100 L 280 100 L 280 140" delay={0.9} stroke={AMBER} width={2.4} />
    <TravellingDot d="M 90 140 L 310 140" delay={1.2} dur={2.4} color={AMBER} />
    <Label x={250} y={88} size={10} fill={AMBER} delay={1.7}>{'R = ρl/A'}</Label>
    <Label x={120} y={168} size={10} fill={PINK} delay={1.6}>{'V'}</Label>
  </g>
);

/** Three overlapping circles — the Union/State/Concurrent lists. */
const federalism: ReactNode = (
  <g key="federalism">
    <g fillOpacity={0.16} strokeWidth={2}>
      <circle cx={150} cy={104} r={54} fill={CYAN} stroke={CYAN} />
      <circle cx={250} cy={104} r={54} fill={PINK} stroke={PINK} />
      <circle cx={200} cy={140} r={54} fill={AMBER} stroke={AMBER} />
    </g>
    <Label x={112} y={68} size={11} fill={CYAN} delay={0.8}>{'Union'}</Label>
    <Label x={252} y={68} size={11} fill={PINK} delay={0.9}>{'State'}</Label>
    <Label x={200} y={186} size={11} fill={AMBER} delay={1}>{'Both'}</Label>
    <Label x={132} y={104} size={9} delay={1.2}>{'defence'}</Label>
    <Label x={268} y={104} size={9} delay={1.3}>{'police'}</Label>
    <Label x={200} y={132} size={9} delay={1.4}>{'education'}</Label>
  </g>
);

/** Bar chart of GDP by sector. */
const gdpBars: ReactNode = (
  <g key="gdp">
    <Axes x0={60} y0={150} w={300} h={120} ticksX={3} ticksY={4} />
    <Fade delay={0.6}>
      <rect x={100} y={70} width={54} height={80} fill={CYAN} opacity={0.85} rx={3} />
    </Fade>
    <Fade delay={1}>
      <rect x={186} y={108} width={54} height={42} fill={AMBER} opacity={0.85} rx={3} />
    </Fade>
    <Fade delay={1.4}>
      <rect x={272} y={38} width={54} height={112} fill={PINK} opacity={0.85} rx={3} />
    </Fade>
    <Label x={127} y={164} size={10} delay={1.8}>{'primary'}</Label>
    <Label x={213} y={164} size={10} delay={1.9}>{'secondary'}</Label>
    <Label x={299} y={164} size={10} delay={2}>{'tertiary'}</Label>
    <Label x={299} y={30} size={10} fill={PINK} delay={2.1}>{'largest'}</Label>
  </g>
);

/** Seasons wheel — climate. */
const seasons: ReactNode = (
  <g key="seasons">
    <g className="fig-spin-slow">
      <circle cx={200} cy={100} r={66} fill="none" stroke={WHITE} strokeWidth={1.6} opacity={0.7} />
    </g>
    {[
      { a: 0, c: AMBER, label: 'summer' },
      { a: 90, c: LIME, label: 'monsoon' },
      { a: 180, c: '#9ad7ff', label: 'winter' },
      { a: 270, c: PURPLE, label: 'retreat' },
    ].map((s, i) => (
      <g key={s.label}>
        <Fade delay={0.5 + i * 0.25}>
          <circle
            cx={200 + 66 * Math.cos((s.a * Math.PI) / 180)}
            cy={100 + 66 * Math.sin((s.a * Math.PI) / 180)}
            r={12}
            fill={s.c}
          />
        </Fade>
      </g>
    ))}
    <Fade delay={1.4}>
      <circle cx={200} cy={100} r={26} fill={PINK} opacity={0.9} />
    </Fade>
    <Label x={200} y={105} size={10} delay={1.6} fill="#1c0c42">{'monsoon'}</Label>
    <Label x={200} y={186} size={10} delay={1.8}>{'seasonal reversal of wind'}</Label>
  </g>
);

/** Tense timeline — past / present / future with backshifting arrows. */
const tenseTimeline: ReactNode = (
  <g key="tense">
    <Draw d="M 50 110 L 350 110" delay={0.1} stroke={WHITE} width={2} />
    <Fade delay={0.5}>
      {[60, 140, 200, 260, 320].map((x, i) => (
        <circle key={x} cx={x} cy={110} r={5} fill={i === 2 ? AMBER : CYAN} />
      ))}
    </Fade>
    <Label x={110} y={100} size={10} delay={0.9} fill={CYAN}>{'past'}</Label>
    <Label x={200} y={100} size={10} delay={1} fill={AMBER}>{'now'}</Label>
    <Label x={292} y={100} size={10} delay={1.1} fill={CYAN}>{'future'}</Label>
    <Draw d="M 80 60 L 180 60" delay={1.2} stroke={PINK} width={2.4} />
    <Draw d="M 100 46 L 80 60 L 100 74" delay={1.6} stroke={PINK} width={2.4} />
    <Label x={130} y={44} size={10} fill={PINK} delay={1.9}>{'backshift'}</Label>
    <Label x={200} y={150} size={11} delay={2.1}>{'was / were → reported'}</Label>
  </g>
);

/** Clause diagram — main clause above, subordinate below. */
const clauses: ReactNode = (
  <g key="clauses">
    <Fade delay={0.4}>
      <rect x={110} y={54} width={180} height={44} rx={8} fill="none" stroke={AMBER} strokeWidth={2.4} />
    </Fade>
    <Label x={200} y={82} delay={0.8} fill={AMBER}>{'we went out'}</Label>
    <Fade delay={1.1}>
      <rect x={110} y={126} width={180} height={40} rx={8} fill="none" stroke={CYAN} strokeWidth={2.2} strokeDasharray="6 4" />
    </Fade>
    <Label x={200} y={152} delay={1.4} fill={CYAN}>{'although it rained'}</Label>
    <Draw d="M 200 98 L 200 126" delay={1.6} stroke={PINK} width={2} />
    <Label x={306} y={118} size={10} fill={PINK} delay={1.9}>{'depends on'}</Label>
  </g>
);

/** Venn of a plant + light → food (photosynthesis). */
const photosynthesis: ReactNode = (
  <g key="photo">
    <g fillOpacity={0.18} strokeWidth={2}>
      <circle cx={150} cy={110} r={58} fill={LIME} stroke={LIME} />
      <circle cx={250} cy={110} r={58} fill={AMBER} stroke={AMBER} />
    </g>
    <Label x={120} y={72} size={11} fill={LIME} delay={0.7}>{'CO₂ + H₂O'}</Label>
    <Label x={282} y={72} size={11} fill={AMBER} delay={0.8}>{'light'}</Label>
    <Fade delay={1.1}>
      <circle cx={200} cy={140} r={30} fill={PINK} opacity={0.9} />
    </Fade>
    <Label x={200} y={145} size={10} fill="#1c0c42" delay={1.4}>{'glucose'}</Label>
    <Label x={200} y={190} size={11} delay={1.7}>{'6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂'}</Label>
  </g>
);

/** Fallback: generic neon geometry per subject. */
const generic: ReactNode = (
  <g key="generic">
    <g className="fig-spin-slow">
      <circle cx={200} cy={100} r={62} fill="none" stroke={PURPLE} strokeWidth={2.4} />
      <polygon points="200,44 246,126 154,126" fill="none" stroke={CYAN} strokeWidth={2.4} />
      <rect x={168} y={68} width={64} height={64} fill="none" stroke={PINK} strokeWidth={2.4} />
    </g>
    <Fade delay={1}>
      <circle cx={200} cy={100} r={8} fill={AMBER} className="fig-pulse" />
    </Fade>
  </g>
);

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const FIGURES: Record<string, ReactNode> = {
  parabola,
  cubic,
  velocityTime,
  trapezoid,
  rightTriangle,
  numberLine,
  balance,
  atom,
  reflection,
  circuit,
  federalism,
  gdpBars,
  seasons,
  tenseTimeline,
  clauses,
  photosynthesis,
  generic,
};

/**
 * Which figure each shipped lesson uses. Keyed by lesson id so adding a
 * chapter is a one-line change here.
 */
export const LESSON_FIGURES: Record<string, string> = {
  // --- Class 8
  'c8-math-rational-numbers': 'balance',
  'c8-math-linear-equations': 'balance',
  'c8-math-mensuration': 'trapezoid',
  'c8-sci-force-pressure': 'generic',
  'c8-sci-combustion-flame': 'generic',
  'c8-sci-microorganisms': 'generic',
  'c8-sst-resources': 'generic',
  'c8-sst-agriculture': 'seasons',
  'c8-sst-constitution': 'federalism',
  'c8-en-tenses': 'tenseTimeline',
  'c8-en-active-passive': 'clauses',
  'c8-en-comprehension': 'generic',
  // --- Class 9
  'c9-math-polynomials': 'cubic',
  'c9-math-number-systems': 'numberLine',
  'c9-math-lines-angles': 'rightTriangle',
  'c9-sci-matter-surroundings': 'generic',
  'c9-sci-motion': 'velocityTime',
  'c9-sci-atoms-molecules': 'atom',
  'c9-sst-democracy': 'generic',
  'c9-sst-climate': 'seasons',
  'c9-sst-food-security': 'gdpBars',
  'c9-en-reported-speech': 'tenseTimeline',
  'c9-en-conditionals': 'tenseTimeline',
  'c9-en-passive-voice': 'clauses',
  // --- Class 10
  'c10-math-real-numbers': 'numberLine',
  'c10-math-quadratic-equations': 'parabola',
  'c10-math-trigonometry': 'rightTriangle',
  'c10-math-probability': 'gdpBars',
  'c10-sci-chemical-reactions': 'photosynthesis',
  'c10-sci-life-processes': 'photosynthesis',
  'c10-sci-light': 'reflection',
  'c10-sci-electricity': 'circuit',
  'c10-sst-development': 'gdpBars',
  'c10-sst-sectors-economy': 'gdpBars',
  'c10-sst-federalism': 'federalism',
  'c10-sst-resources-development': 'generic',
  'c10-en-clauses': 'clauses',
  'c10-en-determiners': 'generic',
  'c10-en-tenses': 'tenseTimeline',
};

export function figureForLesson(lessonId: string | undefined): ReactNode {
  const key = (lessonId && LESSON_FIGURES[lessonId]) || 'generic';
  return FIGURES[key] ?? generic;
}

export { VIEW_W, VIEW_H };