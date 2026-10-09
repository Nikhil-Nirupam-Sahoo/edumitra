/**
 * Curriculum figures — one per chapter, mapped 1:1 to lesson id.
 *
 * Drawn in Manim's visual language: clean bright strokes on the app's neon
 * palette, labelled points and axes, and figures that DRAW themselves on
 * (stroke-dashoffset, like `Create`) while objects travel along paths
 * (`MoveAlongPath`). Everything is SVG + CSS, so it is offline and
 * resolution-independent, and it freezes under `prefers-reduced-motion`.
 *
 * Rule for this file: a figure must teach the chapter's actual idea. If a
 * diagram would be decoration rather than explanation, it does not belong here
 * (see figures.test.ts, which also fails if a lesson is unmapped).
 */

import type { ReactNode } from 'react';

const CYAN = '#00e5ff';
const PINK = '#ff2d95';
const AMBER = '#ffd166';
const LIME = '#7cf03d';
const PURPLE = '#b388ff';
const RED = '#ff6b6b';
const WHITE = '#eaf6ff';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** A path that draws itself on (Manim `Create`). */
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
  dashed?: boolean;
}) {
  return (
    <path
      d={d}
      fill={fill}
      stroke={dashed ? 'none' : stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? '5 4' : undefined}
      pathLength={dashed ? undefined : 1}
      className={dashed ? undefined : 'fig-draw'}
      style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }}
    />
  );
}

/** Fades and rises in (Manim `FadeIn`). */
function Fade({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <g className="fig-fade" style={{ animationDelay: `${delay}s` }}>
      {children}
    </g>
  );
}

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

/** Box outline used for containers/lists. */
function Box({
  x,
  y,
  w,
  h,
  stroke = CYAN,
  delay = 0,
  rx = 6,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: string;
  delay?: number;
  rx?: number;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={rx}
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      className="fig-fade"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

/** An arrow head + shaft. */
function Arrow({
  x1,
  y1,
  x2,
  y2,
  stroke = AMBER,
  delay = 0.6,
  width = 2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  delay?: number;
  width?: number;
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 8;
  const hx = x2 - head * Math.cos(angle - Math.PI / 7);
  const hy = y2 - head * Math.sin(angle - Math.PI / 7);
  const hx2 = x2 - head * Math.cos(angle + Math.PI / 7);
  const hy2 = y2 - head * Math.sin(angle + Math.PI / 7);
  return (
    <g className="fig-fade" style={{ animationDelay: `${delay}s` }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      <polygon
        points={`${x2},${y2} ${hx},${hy} ${hx2},${hy2}`}
        fill={stroke}
        stroke="none"
      />
    </g>
  );
}

/** An object moving along its own path. */
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
  return (
    <circle
      r={r}
      fill={color}
      className="fig-travel"
      style={{
        animationDelay: `${delay}s`,
        animationDuration: `${dur}s`,
        ['--fig-path' as string]: `path('${d}')`,
      }}
    />
  );
}

/** A pulsing dot (nucleus, highlighted value). */
function Pulse({ cx, cy, r = 5, fill = AMBER, delay = 0 }: { cx: number; cy: number; r?: number; fill?: string; delay?: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      className="fig-fade fig-pulse"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

function RightAngle({ x, y, s = 9, delay = 0.8 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <Fade delay={delay}>
      <path d={`M ${x} ${y + s} L ${x + s} ${y + s} L ${x + s} ${y}`} fill="none" stroke={WHITE} strokeWidth={1.6} />
    </Fade>
  );
}

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
            x1={x0 + (w / ticksX) * (i + 1)}
            y1={y0 - 3}
            x2={x0 + (w / ticksX) * (i + 1)}
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
      </Fade>
    </g>
  );
}

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
    const sy = y0 - ((f(xv) - yMin) / (yMax - yMin)) * h;
    pts.push(`${(x0 + ((xv - xMin) / (xMax - xMin)) * w).toFixed(2)},${sy.toFixed(2)}`);
  }
  return <Draw d={`M ${pts.join(' L ')}`} delay={delay} dur={dur} stroke={color} width={2.6} />;
}

/* -------------------------------------------------------------------------- */
/* CLASS 8                                                                    */
/* -------------------------------------------------------------------------- */

/** Rational Numbers — fractions as points on a number line. */
const rationalNumberLine: ReactNode = (
  <g key="rationals">
    <Draw d="M 40 110 L 360 110" delay={0.1} stroke={WHITE} width={1.8} />
    <Fade delay={0.5}>
      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <g key={v}>
          <line x1={70 + i * 65} y1={104} x2={70 + i * 65} y2={116} stroke={WHITE} strokeWidth={1.4} />
          <text x={70 + i * 65} y={132} fontSize={10} fill={WHITE} textAnchor="middle" fontFamily="ui-monospace, monospace">
            {['0', '1/4', '1/2', '3/4', '1'][i]}
          </text>
        </g>
      ))}
    </Fade>
    <Pulse cx={135} cy={110} r={6} fill={PINK} delay={1.2} />
    <Pulse cx={200} cy={110} r={6} fill={AMBER} delay={1.4} />
    <Label x={135} y={90} size={10} fill={PINK} delay={1.6}>{'3/8'}</Label>
    <Label x={200} y={90} size={10} fill={AMBER} delay={1.7}>{'1/2'}</Label>
    <Label x={200} y={172} size={11} delay={2}>{'infinitely many between any two'}</Label>
  </g>
);

/** Linear Equations — balance scale. */
const balance: ReactNode = (
  <g key="balance">
    <Draw d="M 200 60 L 200 140" delay={0.1} stroke={WHITE} width={2.4} />
    <Draw d="M 140 160 L 260 160" delay={0.4} stroke={WHITE} width={2.4} />
    <Draw d="M 92 84 L 308 84" delay={0.7} stroke={CYAN} width={3} />
    <Draw d="M 200 56 L 200 84" delay={0.9} stroke={CYAN} width={2.2} />
    <Fade delay={1.2}>
      {/* shallow pans hanging from the beam */}
      <path d="M 76 100 Q 92 114 108 100" fill="none" stroke={PINK} strokeWidth={2.2} />
      <line x1={76} y1={100} x2={108} y2={100} stroke={PINK} strokeWidth={2.2} />
      <path d="M 292 100 Q 308 114 324 100" fill="none" stroke={PINK} strokeWidth={2.2} />
      <line x1={292} y1={100} x2={324} y2={100} stroke={PINK} strokeWidth={2.2} />
    </Fade>
    <Label x={92} y={130} size={10} delay={1.6}>{'2x+3'}</Label>
    <Label x={308} y={130} size={10} delay={1.6}>{'9'}</Label>
    <TravellingDot d="M 240 160 L 160 160" delay={1.8} dur={2.6} />
    <Label x={200} y={184} size={11} fill={AMBER} delay={2.4}>{'same operation on both sides'}</Label>
  </g>
);

/** Mensuration — trapezium split into rectangle + triangle. */
const trapezoid: ReactNode = (
  <g key="trapezoid">
    <Draw d="M 90 140 L 150 60 L 310 60 L 330 140 Z" delay={0.2} stroke={CYAN} width={2.6} />
    <RightAngle x={150} y={140} delay={1.1} />
    <Draw d="M 220 60 L 220 140" delay={1.2} stroke={PINK} width={1.6} dashed />
    <Label x={210} y={78} fill={PINK} delay={1.6}>{'h'}</Label>
    <Label x={112} y={158} delay={1.5}>{'a'}</Label>
    <Label x={322} y={158} delay={1.5}>{'b'}</Label>
    <Label x={210} y={182} size={11} fill={AMBER} delay={1.8}>{'Area = ½(a + b)h'}</Label>
  </g>
);

/** Force & Pressure — same force, different contact area. */
const pressureBlocks: ReactNode = (
  <g key="pressure">
    <Arrow x1={120} y1={24} x2={120} y2={62} stroke={AMBER} delay={0.3} width={3} />
    <Label x={120} y={18} size={10} fill={AMBER} delay={0.5}>{'F'}</Label>
    <Draw d="M 90 66 L 150 66 L 150 106 L 90 106 Z" delay={0.7} stroke={CYAN} width={2.4} />
    <Label x={120} y={124} size={10} delay={1.2}>{'big area'}</Label>

    <Arrow x1={280} y1={24} x2={280} y2={74} stroke={AMBER} delay={0.9} width={3} />
    <Label x={280} y={18} size={10} fill={AMBER} delay={1.1}>{'F'}</Label>
    <Draw d="M 268 78 L 292 78 L 292 106 L 268 106 Z" delay={1.3} stroke={PINK} width={2.4} />
    <Label x={280} y={124} size={10} fill={PINK} delay={1.6}>{'small area'}</Label>

    <Label x={200} y={156} size={12} delay={2}>{'P = F ÷ A   →   small A, big pressure'}</Label>
    <Label x={200} y={182} size={10} delay={2.3} fill={AMBER}>{'knife edge / narrow strap'}</Label>
  </g>
);

/** Combustion & Flame — candle with the three zones labelled. */
const candleFlame: ReactNode = (
  <g key="flame">
    <Draw d="M 170 160 L 230 160 L 230 190 L 170 190 Z" delay={0.2} stroke={WHITE} width={2.2} />
    <path
      d="M 200 40 C 216 62 224 78 224 96 C 224 116 214 128 200 128 C 186 128 176 116 176 96 C 176 78 184 62 200 40 Z"
      fill="none"
      stroke={AMBER}
      strokeWidth={2.4}
      pathLength={1}
      className="fig-draw"
      style={{ animationDelay: '0.6s', animationDuration: '1.2s' }}
    />
    <Fade delay={1.4}>
      <path d="M 200 62 C 210 78 214 88 214 100 C 214 112 208 120 200 120 C 192 120 186 112 186 100 C 186 88 190 78 200 62 Z" fill="none" stroke={CYAN} strokeWidth={1.8} />
      <path d="M 200 92 C 205 100 207 106 207 112 C 207 118 204 122 200 122 C 196 122 193 118 193 112 C 193 106 195 100 200 92 Z" fill={PURPLE} opacity={0.75} />
    </Fade>
    <Draw d="M 200 40 L 300 40" delay={1.6} stroke={AMBER} width={1} dashed />
    <Label x={304} y={44} anchor="start" size={10} fill={AMBER} delay={1.8}>{'outermost: hottest'}</Label>
    <Draw d="M 200 92 L 100 92" delay={1.7} stroke={PURPLE} width={1} dashed />
    <Label x={96} y={96} anchor="end" size={10} fill={PURPLE} delay={1.9}>{'innermost: cool'}</Label>
    <Label x={200} y={172} size={11} delay={2.1}>{'fuel + O₂ + ignition temp'}</Label>
  </g>
);

/** Microorganisms — friends and foes. */
const microbes: ReactNode = (
  <g key="microbes">
    <Box x={40} y={40} w={150} h={110} stroke={LIME} delay={0.2} />
    <Label x={115} y={34} size={11} fill={LIME} delay={0.5}>{'helpful'}</Label>
    <Fade delay={0.8}>
      <circle cx={80} cy={78} r={9} fill={LIME} opacity={0.8} />
      <circle cx={130} cy={70} r={7} fill={LIME} opacity={0.8} />
      <circle cx={100} cy={120} r={10} fill={LIME} opacity={0.8} />
      <text x={80} y={82} fontSize={9} fill="#0a2a10" textAnchor="middle" fontFamily="ui-monospace, monospace">L</text>
    </Fade>
    <Label x={115} y={168} size={9} fill={LIME} delay={1.4}>{'curd · bread · nitrogen'}</Label>

    <Box x={210} y={40} w={150} h={110} stroke={RED} delay={0.4} />
    <Label x={285} y={34} size={11} fill={RED} delay={0.7}>{'harmful'}</Label>
    <Fade delay={1}>
      <circle cx={250} cy={80} r={9} fill={RED} opacity={0.8} />
      <circle cx={300} cy={72} r={7} fill={RED} opacity={0.8} />
      <circle cx={272} cy={122} r={10} fill={RED} opacity={0.8} />
      <circle cx={330} cy={120} r={6} fill={RED} opacity={0.6} />
    </Fade>
    <Label x={285} y={168} size={9} fill={RED} delay={1.6}>{'disease · spoilage'}</Label>
    <Label x={200} y={190} size={10} delay={2}>{'salt · sugar · oil · pasteurise'}</Label>
  </g>
);

/** Resources — renewable vs non-renewable. */
const resourceBins: ReactNode = (
  <g key="resources">
    <Box x={40} y={44} w={150} h={106} stroke={LIME} delay={0.2} />
    <Label x={115} y={38} size={11} fill={LIME} delay={0.5}>{'renewable'}</Label>
    <Fade delay={0.8}>
      {['water', 'sun', 'wind', 'forest'].map((t, i) => (
        <text key={t} x={56} y={72 + i * 20} fontSize={11} fill={LIME} fontFamily="ui-monospace, monospace">
          {`• ${t}`}
        </text>
      ))}
    </Fade>

    <Box x={210} y={44} w={150} h={106} stroke={PINK} delay={0.4} />
    <Label x={285} y={38} size={11} fill={PINK} delay={0.7}>{'non-renewable'}</Label>
    <Fade delay={1}>
      {['coal', 'petrol', 'minerals'].map((t, i) => (
        <text key={t} x={226} y={72 + i * 24} fontSize={11} fill={PINK} fontFamily="ui-monospace, monospace">
          {`• ${t}`}
        </text>
      ))}
    </Fade>
    <Label x={200} y={172} size={10} delay={1.6}>{'use wisely — plan for the next generation'}</Label>
  </g>
);

/** Agriculture — Kharif / Rabi / Zaid seasons. */
const cropSeasons: ReactNode = (
  <g key="crops">
    <g className="fig-spin-slow">
      <circle cx={200} cy={100} r={66} fill="none" stroke={WHITE} strokeWidth={1.6} opacity={0.6} />
    </g>
    {[
      { a: -90, c: CYAN, name: 'Kharif', crop: 'rice · cotton', d: 0.5 },
      { a: 30, c: AMBER, name: 'Rabi', crop: 'wheat · mustard', d: 0.8 },
      { a: 150, c: LIME, name: 'Zaid', crop: 'melon · cucumber', d: 1.1 },
    ].map((s) => (
      <g key={s.name}>
        <Fade delay={s.d}>
          <circle
            cx={200 + 66 * Math.cos((s.a * Math.PI) / 180)}
            cy={100 + 66 * Math.sin((s.a * Math.PI) / 180)}
            r={13}
            fill={s.c}
          />
          <text
            x={200 + 66 * Math.cos((s.a * Math.PI) / 180)}
            y={100 + 66 * Math.sin((s.a * Math.PI) / 180) + 4}
            fontSize={8}
            fill="#1c0c42"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
          >
            {s.name.slice(0, 3)}
          </text>
        </Fade>
      </g>
    ))}
    <Fade delay={1.4}>
      <circle cx={200} cy={100} r={27} fill={PINK} opacity={0.9} />
    </Fade>
    <Label x={200} y={104} size={9} fill="#1c0c42" delay={1.6}>{'crop'}</Label>
    <Label x={92} y={186} size={9} fill={CYAN} delay={1.8}>{'rains'}</Label>
    <Label x={272} y={54} size={9} fill={AMBER} delay={1.9}>{'winter'}</Label>
    <Label x={112} y={54} size={9} fill={LIME} delay={2}>{'summer'}</Label>
  </g>
);

/** Constitution — rights, duties, rule of law. */
const constitutionPillars: ReactNode = (
  <g key="constitution">
    <Draw d="M 120 46 L 200 66 L 280 46 L 280 140 L 200 160 L 120 140 Z" delay={0.2} stroke={WHITE} width={2.2} />
    <Draw d="M 200 66 L 200 160" delay={0.8} stroke={AMBER} width={1.4} dashed />
    <Fade delay={1}>
      {['L', 'C', 'R'].map((l, i) => (
        <text
          key={l}
          x={150 + i * 50}
          y={116}
          fontSize={16}
          fontWeight="800"
          fill={[CYAN, PINK, LIME][i]}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
        >
          {l}
        </text>
      ))}
    </Fade>
    <Label x={150} y={178} size={9} fill={CYAN} delay={1.4}>{'Liberty'}</Label>
    <Label x={200} y={178} size={9} fill={PINK} delay={1.5}>{'Equality'}</Label>
    <Label x={250} y={178} size={9} fill={LIME} delay={1.6}>{'Fraternity'}</Label>
    <Label x={200} y={30} size={10} fill={AMBER} delay={1.9}>{'26 Jan 1950'}</Label>
  </g>
);

/** Tenses — timeline. */
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
    <Draw d="M 90 62 L 190 62" delay={1.2} stroke={PINK} width={2.4} />
    <Arrow x1={90} y1={62} x2={72} y2={62} stroke={PINK} delay={1.5} />
    <Label x={140} y={46} size={10} fill={PINK} delay={1.8}>{'backshift'}</Label>
    <Label x={200} y={150} size={11} delay={2}>{'present · past · future'}</Label>
  </g>
);

/** Active vs Passive voice — who does it vs who receives it. */
const voiceArrows: ReactNode = (
  <g key="voice">
    <Label x={200} y={26} size={11} fill={LIME} delay={0.3}>{'ACTIVE  (subject acts)'}</Label>
    <Box x={50} y={40} w={86} h={40} stroke={LIME} delay={0.5} />
    <Label x={93} y={65} size={10} fill={LIME} delay={0.8}>{'cat'}</Label>
    <Arrow x1={140} y1={60} x2={196} y2={60} stroke={LIME} delay={1} />
    <Box x={200} y={40} w={86} h={40} stroke={LIME} delay={0.7} />
    <Label x={243} y={65} size={10} fill={LIME} delay={1}>{'drinks'}</Label>
    <Box x={292} y={40} w={58} h={40} stroke={LIME} delay={0.9} />
    <Label x={321} y={65} size={10} fill={LIME} delay={1.2}>{'milk'}</Label>

    <Label x={200} y={112} size={11} fill={PINK} delay={1.3}>{'PASSIVE  (subject receives)'}</Label>
    <Box x={50} y={126} w={86} h={40} stroke={PINK} delay={1.5} />
    <Label x={93} y={151} size={10} fill={PINK} delay={1.7}>{'milk'}</Label>
    <Arrow x1={140} y1={146} x2={196} y2={146} stroke={PINK} delay={1.8} />
    <Box x={200} y={126} w={86} h={40} stroke={PINK} delay={1.7} />
    <Label x={243} y={151} size={10} fill={PINK} delay={1.9}>{'is drunk'}</Label>
    <Box x={292} y={126} w={58} h={40} stroke={PINK} delay={1.9} />
    <Label x={321} y={151} size={10} fill={PINK} delay={2.1}>{'cat'}</Label>
    <Label x={200} y={188} size={10} delay={2.3}>{'be + past participle'}</Label>
  </g>
);

/** Reading comprehension — main idea highlighted. */
const mainIdea: ReactNode = (
  <g key="mainidea">
    <Box x={50} y={34} w={300} h={128} stroke={CYAN} delay={0.2} />
    <Fade delay={0.7}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          x1={66}
          y1={56 + i * 18}
          x2={i === 0 ? 300 : 330 - (i % 3) * 40}
          y2={56 + i * 18}
          stroke={WHITE}
          strokeWidth={i === 0 ? 3 : 2}
          opacity={i === 0 ? 1 : 0.45}
        />
      ))}
    </Fade>
    <Fade delay={1.4}>
      <rect x={62} y={48} width={150} height={16} rx={4} fill={AMBER} opacity={0.28} />
    </Fade>
    <Label x={330} y={60} anchor="end" size={10} fill={AMBER} delay={1.7}>{'topic sentence'}</Label>
    <Arrow x1={250} y1={60} x2={250} y2={140} stroke={PINK} delay={1.8} />
    <Label x={200} y={184} size={10} fill={PINK} delay={2.1}>{'main idea = what it is mostly about'}</Label>
  </g>
);

/* -------------------------------------------------------------------------- */
/* CLASS 9                                                                    */
/* -------------------------------------------------------------------------- */

/** Polynomials — cubic curve with a clear S inflection. */
const cubic: ReactNode = (
  <g key="cubic">
    <Axes x0={70} y0={100} w={280} h={84} ticksY={3} />
    <Curve f={(x) => Math.pow(x, 3)} x0={70} y0={100} w={280} h={84} xMin={-1.35} xMax={1.35} yMin={-2.5} yMax={2.5} color={PINK} />
    <Fade delay={2}>
      <circle cx={210} cy={100} r={5} fill={AMBER} />
      <circle cx={132} cy={76} r={4.5} fill={CYAN} />
      <circle cx={288} cy={124} r={4.5} fill={CYAN} />
    </Fade>
    <Label x={218} y={96} anchor="start" size={9} delay={2.2}>{'zero'}</Label>
    <Label x={118} y={70} size={9} fill={CYAN} delay={2.3}>{'x₂'}</Label>
    <Label x={300} y={140} anchor="end" size={9} fill={CYAN} delay={2.3}>{'x₃'}</Label>
    <Label x={200} y={188} size={10} delay={2.5}>{'degree 3 · turns twice'}</Label>
  </g>
);

/** Number Systems — rationals cluster, √2 has no exact place. */
const irrationalZoom: ReactNode = (
  <g key="irrational">
    <Draw d="M 30 110 L 370 110" delay={0.1} stroke={WHITE} width={1.8} />
    <Fade delay={0.5}>
      {[
        { x: 60, l: '1.0' },
        { x: 130, l: '1.2' },
        { x: 176, l: '1.4' },
        { x: 244, l: '1.6' },
        { x: 320, l: '1.8' },
      ].map((t) => (
        <g key={t.l}>
          <line x1={t.x} y1={103} x2={t.x} y2={117} stroke={WHITE} strokeWidth={1.3} />
          <text x={t.x} y={132} fontSize={10} fill={WHITE} textAnchor="middle" fontFamily="ui-monospace, monospace">
            {t.l}
          </text>
        </g>
      ))}
    </Fade>
    <Pulse cx={200} cy={110} r={6} fill={AMBER} delay={1.3} />
    <Label x={200} y={88} size={11} fill={AMBER} delay={1.6}>{'√2 ≈ 1.4142…'}</Label>
    <Label x={200} y={158} size={10} fill={PINK} delay={2}>{'never ends, never repeats'}</Label>
    <Label x={200} y={180} size={10} delay={2.3}>{'rationals: countable · irrationals: uncountable'}</Label>
  </g>
);

/** Lines & Angles — parallel lines and a transversal. */
const parallelTransversal: ReactNode = (
  <g key="parallel">
    <Draw d="M 70 60 L 330 60" delay={0.2} stroke={CYAN} width={2.4} />
    <Draw d="M 70 140 L 330 140" delay={0.5} stroke={CYAN} width={2.4} />
    <Draw d="M 150 34 L 250 166" delay={0.8} stroke={AMBER} width={2.4} />
    {/* ∠1 sits inside the upper line, ∠2 inside the lower line, on the
        alternate sides of the transversal — that is the point of the figure. */}
    <Fade delay={1.2}>
      <path d="M 176 60 A 22 22 0 0 0 165 77" fill="none" stroke={PINK} strokeWidth={1.8} />
      <path d="M 224 140 A 22 22 0 0 0 235 123" fill="none" stroke={PINK} strokeWidth={1.8} />
    </Fade>
    <Label x={160} y={90} anchor="end" size={12} fill={PINK} delay={1.5}>{'1'}</Label>
    <Label x={240} y={112} size={12} fill={PINK} delay={1.6}>{'2'}</Label>
    <Fade delay={1.5}>
      <text x={44} y={65} fontSize={15} fill={CYAN} fontFamily="ui-monospace, monospace">∥</text>
    </Fade>
    <Label x={200} y={186} size={10} delay={1.9}>{'∠1 = ∠2  (alternate interior angles)'}</Label>
  </g>
);

/** Matter in Our Surroundings — particles in the three states. */
const particleStates: ReactNode = (
  <g key="states">
    {[
      { x: 24, title: 'SOLID', color: AMBER, packed: true },
      { x: 144, title: 'LIQUID', color: CYAN, packed: false },
      { x: 264, title: 'GAS', color: PINK, packed: false },
    ].map((s) => (
      <g key={s.title}>
        <Box x={s.x} y={44} w={112} h={106} stroke={s.color} delay={0.2} />
        <Label x={s.x + 56} y={38} size={10} fill={s.color} delay={0.5}>
          {s.title}
        </Label>
        <Fade delay={0.8}>
          {s.packed
            ? [0, 1, 2].map((r) =>
                [0, 1, 2].map((c) => (
                  <circle key={`${r}-${c}`} cx={s.x + 24 + c * 32} cy={72 + r * 30} r={9} fill={s.color} opacity={0.85} />
                )),
              )
            : [
                { dx: 22, dy: 20 },
                { dx: 62, dy: 44 },
                { dx: 40, dy: 74 },
                { dx: 82, dy: 86 },
                { dx: 16, dy: 96 },
              ].map((p, i) => (
                <circle key={i} cx={s.x + p.dx} cy={44 + p.dy} r={8} fill={s.color} opacity={0.8} />
              ))}
        </Fade>
      </g>
    ))}
    <Label x={200} y={172} size={10} delay={1.6}>{'particle spacing decides the state'}</Label>
    <Label x={200} y={192} size={10} fill={AMBER} delay={1.9}>{'heating spreads them apart'}</Label>
  </g>
);

/** Motion — velocity–time graph with impulse area. */
const velocityTime: ReactNode = (
  <g key="vtime">
    <Axes x0={55} y0={150} w={310} h={125} />
    <Fade delay={0.5}>
      <polygon points="55,150 120,70 120,150" fill={AMBER} opacity={0.2} />
    </Fade>
    <Draw d="M 55 150 L 120 70" delay={0.6} stroke={CYAN} width={2.6} />
    <TravellingDot d="M 55 150 L 120 70" delay={1} dur={2.4} color={AMBER} />
    <Fade delay={2}>
      <circle cx={120} cy={70} r={4.5} fill={PINK} />
    </Fade>
    <Label x={128} y={68} fill={PINK} delay={2.2}>{'v'}</Label>
    <Label x={118} y={164} delay={2.2}>{'t'}</Label>
    <Label x={168} y={126} size={10} fill={AMBER} delay={2.4}>{'area = impulse'}</Label>
    <Label x={168} y={142} size={10} delay={2.6}>{'slope = acceleration'}</Label>
  </g>
);

/** Atoms & Molecules — atom with orbiting electrons. */
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
    <Label x={200} y={190} size={10} delay={1.4}>{'atoms bond → molecules'}</Label>
  </g>
);

/** Democracy — people vote, government is chosen. */
const ballotBox: ReactNode = (
  <g key="democracy">
    <Fade delay={0.4}>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <circle cx={54 + i * 34} cy={56} r={9} fill={CYAN} opacity={0.85} />
          <path d={`M ${54 + i * 34 - 10} 86 L ${54 + i * 34} 68 L ${54 + i * 34 + 10} 86 Z`} fill={CYAN} opacity={0.85} />
        </g>
      ))}
    </Fade>
    <Label x={112} y={110} size={10} delay={1}>{'one person, one vote'}</Label>
    <Arrow x1={112} y1={118} x2={112} y2={140} stroke={AMBER} delay={1.2} />
    <Draw d="M 84 142 L 140 142 L 134 182 L 90 182 Z" delay={1.4} stroke={AMBER} width={2.2} />
    <Label x={112} y={168} size={9} fill={AMBER} delay={1.8}>{'ballot'}</Label>
    <Arrow x1={150} y1={160} x2={200} y2={160} stroke={LIME} delay={1.9} />
    <Box x={206} y={132} w={150} h={58} stroke={LIME} delay={2} />
    <Label x={281} y={155} size={10} fill={LIME} delay={2.2}>{'government'}</Label>
    <Label x={281} y={172} size={9} delay={2.3}>{'chosen by the people'}</Label>
    <Label x={200} y={196} size={9} delay={2.5}>{'accountable · rule of law'}</Label>
  </g>
);

/** Climate — seasons wheel. */
const seasons: ReactNode = (
  <g key="seasons">
    <g className="fig-spin-slow">
      <circle cx={200} cy={100} r={66} fill="none" stroke={WHITE} strokeWidth={1.6} opacity={0.7} />
    </g>
    {[
      { a: 0, c: AMBER },
      { a: 90, c: LIME },
      { a: 180, c: '#9ad7ff' },
      { a: 270, c: PURPLE },
    ].map((s, i) => (
      <Fade key={i} delay={0.5 + i * 0.25}>
        <circle
          cx={200 + 66 * Math.cos((s.a * Math.PI) / 180)}
          cy={100 + 66 * Math.sin((s.a * Math.PI) / 180)}
          r={12}
          fill={s.c}
        />
      </Fade>
    ))}
    <Fade delay={1.4}>
      <circle cx={200} cy={100} r={27} fill={PINK} opacity={0.9} />
    </Fade>
    <Label x={200} y={105} size={10} fill="#1c0c42" delay={1.6}>{'monsoon'}</Label>
    <Label x={200} y={188} size={10} delay={1.9}>{'wind reverses with the seasons'}</Label>
  </g>
);

/** Food Security — farm → buffer stock → ration shop → family. */
const foodChain: ReactNode = (
  <g key="foodsecurity">
    <Fade delay={0.3}>
      <path d="M 60 96 L 46 132 L 74 132 Z" fill={LIME} opacity={0.85} />
      <rect x={44} y={132} width={34} height={6} fill={LIME} opacity={0.6} />
      <text x={60} y={82} fontSize={9} fill={LIME} textAnchor="middle" fontFamily="ui-monospace, monospace">farm</text>
    </Fade>
    <Arrow x1={86} y1={112} x2={118} y2={112} stroke={AMBER} delay={0.8} />
    <Fade delay={0.9}>
      <path d="M 124 96 L 156 96 L 156 132 L 124 132 Z" fill="none" stroke={AMBER} strokeWidth={2} />
      <path d="M 124 96 L 140 82 L 156 96 Z" fill={AMBER} opacity={0.7} />
      <text x={140} y={146} fontSize={9} fill={AMBER} textAnchor="middle" fontFamily="ui-monospace, monospace">stock</text>
    </Fade>
    <Arrow x1={166} y1={112} x2={198} y2={112} stroke={AMBER} delay={1.2} />
    <Fade delay={1.3}>
      <rect x={204} y={92} width={54} height={44} fill="none" stroke={CYAN} strokeWidth={2} />
      <text x={231} y={112} fontSize={9} fill={CYAN} textAnchor="middle" fontFamily="ui-monospace, monospace">
        ration
      </text>
      <text x={231} y={126} fontSize={9} fill={CYAN} textAnchor="middle" fontFamily="ui-monospace, monospace">
        shop
      </text>
    </Fade>
    <Arrow x1={266} y1={112} x2={298} y2={112} stroke={LIME} delay={1.6} />
    <Fade delay={1.7}>
      {[0, 1].map((i) => (
        <g key={i}>
          <circle cx={316} cy={82 + i * 34} r={8} fill={LIME} opacity={0.85} />
          <path d={`M ${316 - 9} 108 + i * 34 L ${316} 92 + i * 34 L ${316 + 9} 108 + i * 34 Z`} fill={LIME} opacity={0.85} />
        </g>
      ))}
    </Fade>
    <Label x={200} y={168} size={10} delay={2}>{'available · affordable · accessible'}</Label>
    <Label x={200} y={188} size={9} delay={2.2} fill={AMBER}>{'MSP buys grain → buffer stock → PDS'}</Label>
  </g>
);

/** Reported Speech — direct becomes reported, verb backshifts. */
const reportedArrow: ReactNode = (
  <g key="reported">
    <Box x={24} y={40} w={150} h={62} stroke={CYAN} delay={0.2} rx={10} />
    <Label x={99} y={66} size={10} fill={CYAN} delay={0.6}>{'"I am busy."'}</Label>
    <Label x={99} y={86} size={9} delay={0.8}>{'direct speech'}</Label>

    <Arrow x1={182} y1={71} x2={216} y2={71} stroke={AMBER} delay={1} />
    <Label x={199} y={56} size={9} fill={AMBER} delay={1.2}>{'says'}</Label>

    <Box x={224} y={40} w={152} h={62} stroke={PINK} delay={1.1} rx={10} />
    <Label x={300} y={66} size={10} fill={PINK} delay={1.4}>{'"he was busy"'}</Label>
    <Label x={300} y={86} size={9} delay={1.6}>{'reported speech'}</Label>

    <Draw d="M 60 128 L 340 128" delay={1.6} stroke={WHITE} width={1.4} />
    <Fade delay={1.9}>
      {['am → was', 'is → was', 'will → would', 'today → that day'].map((t, i) => (
        <text key={t} x={70 + (i % 2) * 160} y={152 + Math.floor(i / 2) * 20} fontSize={10} fill={LIME} fontFamily="ui-monospace, monospace">
          {t}
        </text>
      ))}
    </Fade>
    <Label x={200} y={192} size={9} delay={2.3}>{'tense moves one step back · pronouns change'}</Label>
  </g>
);

/** Conditionals — three branches. */
const conditionalBranches: ReactNode = (
  <g key="conditionals">
    <Box x={30} y={80} w={92} h={40} stroke={AMBER} delay={0.2} />
    <Label x={76} y={105} size={10} fill={AMBER} delay={0.5}>{'if …'}</Label>
    {[
      { y: 28, tag: 'ZERO', ex: 'ice melts', color: LIME },
      { y: 92, tag: 'FIRST', ex: 'will cancel', color: CYAN },
      { y: 156, tag: 'SECOND', ex: 'would go', color: PINK },
    ].map((r, i) => (
      <g key={r.tag}>
        <Arrow x1={128} y1={100} x2={168} y2={r.y + 14} stroke={r.color} delay={0.7 + i * 0.3} />
        <Box x={166} y={r.y} w={86} h={30} stroke={r.color} delay={0.8 + i * 0.3} />
        <Label x={209} y={r.y + 20} size={10} fill={r.color} delay={1 + i * 0.3}>
          {r.tag}
        </Label>
        <Label x={262} y={r.y + 20} anchor="start" size={9} delay={1.2 + i * 0.3}>
          {r.ex}
        </Label>
      </g>
    ))}
  </g>
);

/* -------------------------------------------------------------------------- */
/* CLASS 10                                                                   */
/* -------------------------------------------------------------------------- */

/** Real Numbers — HCF / LCM strips on a number line. */
const numberLineHcfLcm: ReactNode = (
  <g key="realnumbers">
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
    <Draw d="M 40 88 L 200 88" delay={0.9} stroke={AMBER} width={3} />
    <Label x={120} y={80} size={9} fill={AMBER} delay={1.2}>{'6 ×2'}</Label>
    <Draw d="M 200 58 L 360 58" delay={1.4} stroke={PINK} width={3} />
    <Label x={280} y={50} size={9} fill={PINK} delay={1.7}>{'12 ×2'}</Label>
    <Pulse cx={200} cy={120} r={5} fill={LIME} delay={2} />
    <Label x={206} y={164} fill={LIME} delay={2.2}>{'LCM'}</Label>
    <Label x={200} y={188} size={10} delay={2.4}>{'HCF × LCM = a × b'}</Label>
  </g>
);

/** Quadratic Equations — parabola. */
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
    <Label x={218} y={58} fill={LIME} delay={2.2}>{'vertex'}</Label>
    <Label x={44} y={186} size={10} delay={2.3}>{'D = b² − 4ac decides'}</Label>
  </g>
);

/** Trigonometry — right triangle with angle A. */
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
    <Label x={252} y={186} size={11} fill={PINK} delay={1.8}>{'sin A = opp/hyp'}</Label>
  </g>
);

/** Chemical Reactions — reactants transform into products. */
const reaction: ReactNode = (
  <g key="reaction">
    <Fade delay={0.3}>
      <rect x={34} y={64} width={104} height={56} rx={6} fill="none" stroke={CYAN} strokeWidth={2} />
      <text x={86} y={88} fontSize={11} fill={CYAN} textAnchor="middle" fontFamily="ui-monospace, monospace">2Mg + O₂</text>
      <text x={86} y={106} fontSize={9} fill={WHITE} textAnchor="middle" fontFamily="ui-monospace, monospace">reactants</text>
    </Fade>
    <Draw d="M 148 92 L 246 92" delay={0.9} stroke={AMBER} width={2.4} />
    <Fade delay={1.2}>
      <path d="M 186 74 C 192 84 192 90 186 100 C 180 90 180 84 186 74 Z" fill={AMBER} />
    </Fade>
    <Label x={197} y={62} size={9} fill={AMBER} delay={1.4}>{'heat'}</Label>

    <Fade delay={1.3}>
      <rect x={252} y={64} width={104} height={56} rx={6} fill="none" stroke={PINK} strokeWidth={2} />
      <text x={304} y={88} fontSize={11} fill={PINK} textAnchor="middle" fontFamily="ui-monospace, monospace">2MgO</text>
      <text x={304} y={106} fontSize={9} fill={WHITE} textAnchor="middle" fontFamily="ui-monospace, monospace">product</text>
    </Fade>
    <Fade delay={1.7}>
      {['colour change', 'gas bubbles', 'precipitate'].map((t, i) => (
        <text key={t} x={54 + i * 110} y={148} fontSize={9} fill={CYAN} fontFamily="ui-monospace, monospace">
          {t}
        </text>
      ))}
    </Fade>
    <Label x={200} y={176} size={10} fill={LIME} delay={2}>{'atoms are conserved — balance the equation'}</Label>
  </g>
);

/** Life Processes — photosynthesis needs CO₂, water and light. */
const photosynthesis: ReactNode = (
  <g key="photo">
    <g fillOpacity={0.18} strokeWidth={2}>
      <circle cx={150} cy={108} r={56} fill={LIME} stroke={LIME} />
      <circle cx={250} cy={108} r={56} fill={AMBER} stroke={AMBER} />
    </g>
    <Label x={116} y={70} size={10} fill={LIME} delay={0.7}>{'CO₂ + H₂O'}</Label>
    <Label x={288} y={70} size={10} fill={AMBER} delay={0.8}>{'light'}</Label>
    <Fade delay={1.1}>
      <circle cx={200} cy={138} r={30} fill={PINK} opacity={0.9} />
    </Fade>
    <Label x={200} y={142} size={10} fill="#1c0c42" delay={1.4}>{'glucose'}</Label>
    <Label x={200} y={186} size={10} delay={1.7}>{'plants make food; we eat it'}</Label>
  </g>
);

/** Light — reflection off a mirror, then refraction through a convex lens. */
const lightMirrorLens: ReactNode = (
  <g key="light">
    {/* ---- mirror (left) ---- */}
    <Draw d="M 30 152 L 150 152" delay={0.1} stroke={WHITE} width={2.4} />
    <Fade delay={0.4}>
      {[...Array(5)].map((_, i) => (
        <line key={i} x1={38 + i * 24} y1={154} x2={26 + i * 24} y2={170} stroke={WHITE} strokeWidth={1} opacity={0.5} />
      ))}
    </Fade>
    <Draw d="M 90 152 L 50 58" delay={0.6} stroke={AMBER} width={2.4} />
    <Draw d="M 90 152 L 130 58" delay={1.2} stroke={CYAN} width={2.4} />
    <TravellingDot d="M 50 58 L 90 152" delay={0.8} dur={2} color={AMBER} />
    <TravellingDot d="M 90 152 L 130 58" delay={1.4} dur={2} color={CYAN} />
    <RightAngle x={90} y={152} s={8} delay={1} />
    <Label x={50} y={50} size={9} fill={AMBER} delay={1.6}>{'in'}</Label>
    <Label x={134} y={50} anchor="start" size={9} fill={CYAN} delay={1.8}>{'reflected'}</Label>
    <Label x={90} y={186} size={9} delay={1.7}>{'mirror: i = r'}</Label>

    <Fade delay={1.5}>
      <line x1={178} y1={40} x2={178} y2={176} stroke={WHITE} strokeWidth={1} strokeDasharray="3 5" opacity={0.45} />
    </Fade>

    {/* ---- convex lens (right): parallel rays converge to a focus ---- */}
    <Fade delay={1.6}>
      <path
        d="M 262 44 C 282 74 282 126 262 156 C 242 126 242 74 262 44 Z"
        fill={PINK}
        opacity={0.22}
        stroke={PINK}
        strokeWidth={2}
      />
    </Fade>
    <Draw d="M 196 62 L 256 62" delay={1.9} stroke={AMBER} width={2.2} />
    <Draw d="M 196 96 L 256 96" delay={2.1} stroke={AMBER} width={2.2} />
    <Draw d="M 268 62 L 330 126" delay={2.3} stroke={LIME} width={2.2} />
    <Draw d="M 268 96 L 330 126" delay={2.5} stroke={LIME} width={2.2} />
    <Draw d="M 330 126 L 374 100" delay={2.7} stroke={LIME} width={1.6} />
    <Pulse cx={330} cy={126} r={4.5} fill={AMBER} delay={2.8} />
    <Label x={330} y={146} size={9} fill={AMBER} delay={2.9}>{'focus'}</Label>
    <Label x={276} y={186} size={9} fill={PINK} delay={2.6}>{'convex lens: bends in'}</Label>
  </g>
);

/** Development — income, health, education all feed development. */
const developmentDials: ReactNode = (
  <g key="development">
    <g fillOpacity={0.2} strokeWidth={2}>
      <circle cx={150} cy={96} r={50} fill={AMBER} stroke={AMBER} />
      <circle cx={250} cy={96} r={50} fill={LIME} stroke={LIME} />
      <circle cx={200} cy={136} r={50} fill={CYAN} stroke={CYAN} />
    </g>
    <Label x={112} y={62} size={10} fill={AMBER} delay={0.6}>{'income'}</Label>
    <Label x={292} y={62} size={10} fill={LIME} delay={0.7}>{'health'}</Label>
    <Label x={200} y={176} size={10} fill={CYAN} delay={0.8}>{'education'}</Label>
    <Fade delay={1.1}>
      <circle cx={200} cy={116} r={16} fill={PINK} opacity={0.95} />
    </Fade>
    <Label x={200} y={120} size={9} fill="#1c0c42" delay={1.3}>{'HDI'}</Label>
    <Label x={200} y={196} size={9} delay={1.6}>{'rich country, poor health = still developing'}</Label>
  </g>
);

/** Sectors — GDP share by sector. */
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
    <Label x={127} y={164} size={9} delay={1.8}>{'primary'}</Label>
    <Label x={213} y={164} size={9} delay={1.9}>{'secondary'}</Label>
    <Label x={299} y={164} size={9} delay={2}>{'tertiary'}</Label>
    <Label x={299} y={30} size={9} fill={PINK} delay={2.1}>{'largest'}</Label>
    <Label x={200} y={188} size={9} delay={2.3}>{'most jobs, yet least output'}</Label>
  </g>
);

/** Federalism — Union / State / Concurrent lists. */
const federalism: ReactNode = (
  <g key="federalism">
    <g fillOpacity={0.16} strokeWidth={2}>
      <circle cx={150} cy={104} r={54} fill={CYAN} stroke={CYAN} />
      <circle cx={250} cy={104} r={54} fill={PINK} stroke={PINK} />
      <circle cx={200} cy={140} r={54} fill={AMBER} stroke={AMBER} />
    </g>
    <Label x={110} y={68} size={10} fill={CYAN} delay={0.8}>{'Union'}</Label>
    <Label x={256} y={68} size={10} fill={PINK} delay={0.9}>{'State'}</Label>
    <Label x={200} y={190} size={10} fill={AMBER} delay={1}>{'Both'}</Label>
    <Label x={126} y={104} size={8} delay={1.2}>{'defence'}</Label>
    <Label x={272} y={104} size={8} delay={1.3}>{'police'}</Label>
    <Label x={200} y={136} size={8} delay={1.4}>{'education'}</Label>
  </g>
);

/** Clauses — main above, subordinate below. */
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
    <Label x={310} y={118} anchor="start" size={9} fill={PINK} delay={1.9}>{'subordinate'}</Label>
    <Label x={92} y={78} anchor="end" size={9} fill={AMBER} delay={1.8}>{'main'}</Label>
  </g>
);

/** Determiners — countable jar vs uncountable jug. */
const determiners: ReactNode = (
  <g key="determiners">
    {/* countable */}
    <Box x={44} y={44} w={130} h={104} stroke={CYAN} delay={0.2} />
    <Label x={109} y={38} size={10} fill={CYAN} delay={0.5}>{'countable'}</Label>
    <Fade delay={0.8}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <circle key={i} cx={70 + (i % 4) * 26} cy={72 + Math.floor(i / 4) * 30} r={8} fill={CYAN} opacity={0.8} />
      ))}
    </Fade>
    <Label x={109} y={168} size={9} fill={CYAN} delay={1.2}>{'many · a few · few'}</Label>

    {/* uncountable */}
    <Box x={222} y={44} w={130} h={104} stroke={PINK} delay={0.4} />
    <Label x={287} y={38} size={10} fill={PINK} delay={0.7}>{'uncountable'}</Label>
    <Fade delay={1}>
      {/* a jug of water: measurable by volume, not by counting */}
      <path d="M 262 62 L 276 62 L 276 84 L 296 118 C 302 134 292 146 274 146 L 252 146 C 234 146 224 134 230 118 L 250 84 L 250 62 Z" fill={PINK} opacity={0.35} stroke={PINK} strokeWidth={1.8} />
      <path d="M 231 122 L 295 122 L 299 132 C 303 142 294 148 276 148 L 250 148 C 232 148 223 142 227 132 Z" fill={PINK} opacity={0.8} />
    </Fade>
    <Label x={287} y={168} size={9} fill={PINK} delay={1.4}>{'much · a little · little'}</Label>
    <Label x={200} y={192} size={9} delay={1.7}>{'an apple · a book · an hour'}</Label>
  </g>
);

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

export const FIGURES: Record<string, ReactNode> = {
  rationalNumberLine,
  balance,
  trapezoid,
  pressureBlocks,
  candleFlame,
  microbes,
  resourceBins,
  cropSeasons,
  constitutionPillars,
  tenseTimeline,
  voiceArrows,
  mainIdea,
  cubic,
  irrationalZoom,
  parallelTransversal,
  particleStates,
  velocityTime,
  atom,
  ballotBox,
  seasons,
  foodChain,
  reportedArrow,
  conditionalBranches,
  numberLineHcfLcm,
  parabola,
  rightTriangle,
  reaction,
  photosynthesis,
  lightMirrorLens,
  developmentDials,
  gdpBars,
  federalism,
  clauses,
  determiners,
};

/**
 * Lesson id → figure. Every shipped lesson appears here exactly once; a figure
 * may be shared by two chapters that genuinely teach the same idea.
 */
export const LESSON_FIGURES: Record<string, string> = {
  // Class 8
  'c8-math-rational-numbers': 'rationalNumberLine',
  'c8-math-linear-equations': 'balance',
  'c8-math-mensuration': 'trapezoid',
  'c8-sci-force-pressure': 'pressureBlocks',
  'c8-sci-combustion-flame': 'candleFlame',
  'c8-sci-microorganisms': 'microbes',
  'c8-sst-resources': 'resourceBins',
  'c8-sst-agriculture': 'cropSeasons',
  'c8-sst-constitution': 'constitutionPillars',
  'c8-en-tenses': 'tenseTimeline',
  'c8-en-active-passive': 'voiceArrows',
  'c8-en-comprehension': 'mainIdea',
  // Class 9
  'c9-math-polynomials': 'cubic',
  'c9-math-number-systems': 'irrationalZoom',
  'c9-math-lines-angles': 'parallelTransversal',
  'c9-sci-matter-surroundings': 'particleStates',
  'c9-sci-motion': 'velocityTime',
  'c9-sci-atoms-molecules': 'atom',
  'c9-sst-democracy': 'ballotBox',
  'c9-sst-climate': 'seasons',
  'c9-sst-food-security': 'foodChain',
  'c9-en-reported-speech': 'reportedArrow',
  'c9-en-conditionals': 'conditionalBranches',
  'c9-en-passive-voice': 'voiceArrows',
  // Class 10
  'c10-math-real-numbers': 'numberLineHcfLcm',
  'c10-math-quadratic-equations': 'parabola',
  'c10-math-trigonometry': 'rightTriangle',
  'c10-sci-chemical-reactions': 'reaction',
  'c10-sci-life-processes': 'photosynthesis',
  'c10-sci-light': 'lightMirrorLens',
  'c10-sst-development': 'developmentDials',
  'c10-sst-sectors-economy': 'gdpBars',
  'c10-sst-federalism': 'federalism',
  'c10-en-clauses': 'clauses',
  'c10-en-determiners': 'determiners',
  'c10-en-tenses': 'tenseTimeline',
};

export function figureForLesson(lessonId: string | undefined): ReactNode {
  const key = (lessonId && LESSON_FIGURES[lessonId]) || undefined;
  return key ? (FIGURES[key] ?? null) : null;
}

export const FIGURE_IDS = Object.keys(FIGURES);