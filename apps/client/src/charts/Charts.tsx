/**
 * SVG chart primitives for the teacher dashboard.
 *
 * WHY HAND-ROLLED SVG:
 *   A charting library (Recharts, Chart.js) is 60–150 kB gzipped and wants to
 *   own layout. The app already draws every visual as SVG for the same reason
 *   it uses no UI kit: crisp at any density, no runtime cost, freezable under
 *   `prefers-reduced-motion`, and zero bytes of third-party code. These are the
 *   five shapes the dashboard actually needs, and each one is small enough to
 *   read in full.
 *
 * Every chart is accessible: a `role="img"` with a summary label plus a
 * visually-hidden data table, so a teacher using a screen reader gets the
 * numbers rather than an unlabelled graphic.
 */

import { useId, type ReactNode } from 'react';

const CYAN = '#00e5ff';
const PINK = '#ff2d95';
const AMBER = '#ffd166';
const LIME = '#7cf03d';
const PURPLE = '#b388ff';

/** Series colours, in order. Chosen to stay distinct on the dark panels. */
export const SERIES = [CYAN, PINK, AMBER, LIME, PURPLE];

export interface Point {
  label: string;
  value: number;
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

/** Screen-reader-only mirror of the chart's data. */
function DataTable({
  caption,
  points,
  valueLabel,
}: {
  caption: string;
  points: Array<{ label: string; value: string | number }>;
  valueLabel: string;
}) {
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.label}>
            <th scope="row">{p.label}</th>
            <td>{p.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

/** Inline trend line with no axes — used in dense table rows. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = CYAN,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="chart chart-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${values.join(', ')}`}
    >
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle
        cx={values.length > 1 ? (values.length - 1) * step : 0}
        cy={height - ((values[values.length - 1]! - min) / span) * (height - 4) - 2}
        r="2.6"
        fill={color}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Line chart                                                                 */
/* -------------------------------------------------------------------------- */

export interface LineSeries {
  name: string;
  points: number[];
}

export function LineChart({
  labels,
  series,
  height = 190,
  valueSuffix = '',
  caption,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  valueSuffix?: string;
  caption: string;
}) {
  const width = 640;
  const pad = { top: 14, right: 12, bottom: 26, left: 38 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gradientId = useId();

  const all = series.flatMap((s) => s.points).filter(Number.isFinite);
  const max = all.length > 0 ? Math.max(...all) : 1;
  const min = all.length > 0 ? Math.min(...all) : 0;
  const span = max - min || 1;
  const ticks = [max, (max + min) / 2, min];

  const count = Math.max(...series.map((s) => s.points.length), 1);
  const xAt = (i: number) => pad.left + (count > 1 ? (i / (count - 1)) * innerW : innerW / 2);
  const yAt = (v: number) => pad.top + innerH - ((clamp(v, min, max) - min) / span) * innerH;

  // Show at most 6 labels so they never collide on a phone.
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <figure className="chart-figure">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={caption}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.28" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="rgba(0,229,255,0.14)"
              strokeWidth="1"
            />
            <text x={4} y={yAt(t) + 4} className="chart-axis-label">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {labels.map((label, i) =>
          i % labelStep === 0 || i === labels.length - 1 ? (
            <text key={label + i} x={xAt(i)} y={height - 8} className="chart-axis-label" textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}

        {series.map((s, si) => {
          const color = SERIES[si % SERIES.length]!;
          const line = s.points
            .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
            .join(' ');
          const area = `${line} L${xAt(s.points.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${xAt(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
          return (
            <g key={s.name}>
              {si === 0 && s.points.length > 1 && (
                <path d={area} fill={`url(#${gradientId})`} stroke="none" />
              )}
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="chart-line"
              />
              {s.points.map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r="3" fill={color}>
                  <title>{`${s.name} · ${labels[i] ?? ''}: ${Math.round(v * 100)}%${valueSuffix}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {series.length > 1 && (
        <figcaption className="chart-legend">
          {series.map((s, i) => (
            <span key={s.name} className="chart-legend-item">
              <span className="chart-swatch" style={{ background: SERIES[i % SERIES.length] }} />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}

      <DataTable
        caption={caption}
        valueLabel="Score %"
        points={series.map((s) => ({
          label: s.name,
          value: s.points.map((v) => Math.round(v * 100)).join(', '),
        }))}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Bar chart                                                                  */
/* -------------------------------------------------------------------------- */

export function BarChart({
  points,
  caption,
  valueSuffix = '%',
  height,
}: {
  points: Point[];
  caption: string;
  valueSuffix?: string;
  height?: number;
}) {
  if (points.length === 0) return null;
  const width = 640;
  const barH = 26;
  const gap = 12;
  const pad = { top: 6, right: 46, bottom: 6, left: 116 };
  const innerW = width - pad.left - pad.right;
  const total = points.length * (barH + gap);
  const viewH = height ?? Math.max(pad.top + pad.bottom + total, 90);
  const max = Math.max(...points.map((p) => p.value), 0.0001);
  const labelId = useId();

  return (
    <figure className="chart-figure">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${viewH}`}
        role="img"
        aria-label={caption}
        preserveAspectRatio="xMidYMid meet"
      >
        {points.map((p, i) => {
          const y = pad.top + i * (barH + gap);
          const w = (clamp(p.value, 0, max) / max) * innerW;
          // Colour carries meaning: red is below the 50% pass mark.
          const color = p.value < 0.5 ? PINK : p.value >= 0.8 ? LIME : CYAN;
          return (
            <g key={p.label}>
              <text
                x={pad.left - 8}
                y={y + barH / 2 + 4}
                className="chart-bar-label"
                textAnchor="end"
              >
                {p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}
              </text>
              <rect
                x={pad.left}
                y={y}
                width={innerW}
                height={barH}
                rx={barH / 2}
                fill="rgba(255,255,255,0.06)"
              />
              <rect x={pad.left} y={y} width={Math.max(w, 2)} height={barH} rx={barH / 2} fill={color}>
                <title>{`${p.label}: ${Math.round(p.value * 100)}${valueSuffix}`}</title>
              </rect>
              <text
                x={pad.left + innerW + 8}
                y={y + barH / 2 + 4}
                className="chart-value-label"
              >
                {Math.round(p.value * 100)}{valueSuffix}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable caption={caption} valueLabel={`Value${valueSuffix}`} points={points} />
      <desc id={labelId}>{caption}</desc>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Radar                                                                      */
/* -------------------------------------------------------------------------- */

/** Subject mastery shape — makes a gap obvious where a list of numbers hides it. */
export function RadarChart({
  axes,
  caption,
  size = 220,
}: {
  axes: Point[];
  caption: string;
  size?: number;
}) {
  if (axes.length < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 30;
  const step = (Math.PI * 2) / axes.length;

  const at = (i: number, ratio: number) => [
    cx + Math.cos(i * step - Math.PI / 2) * r * ratio,
    cy + Math.sin(i * step - Math.PI / 2) * r * ratio,
  ];

  const rings = [0.25, 0.5, 0.75, 1];
  const polygon = axes
    .map((a, i) => {
      const [x, y] = at(i, clamp(a.value, 0, 1));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <figure className="chart-figure chart-figure--radar">
      <svg
        className="chart"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={caption}
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes
              .map((_, i) => {
                const [x, y] = at(i, ring);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ')}
            fill="none"
            stroke="rgba(0,229,255,0.16)"
          />
        ))}
        {axes.map((_, i) => {
          const [x, y] = at(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,229,255,0.16)" />;
        })}
        <polygon points={polygon} fill="rgba(255,45,149,0.28)" stroke={PINK} strokeWidth="2" />
        {axes.map((a, i) => {
          const [x, y] = at(i, clamp(a.value, 0, 1));
          const [lx, ly] = at(i, 1.22);
          return (
            <g key={a.label}>
              <circle cx={x} cy={y} r="3" fill={PINK}>
                <title>{`${a.label}: ${Math.round(a.value * 100)}%`}</title>
              </circle>
              <text
                x={lx}
                y={ly + 4}
                className="chart-axis-label"
                textAnchor={lx < cx - 6 ? 'end' : lx > cx + 6 ? 'start' : 'middle'}
              >
                {a.label.length > 10 ? `${a.label.slice(0, 9)}…` : a.label}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable caption={caption} valueLabel="Mastery %" points={axes} />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity heatmap                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Weeks × days of activity. Reading a gap — "nothing since the 3rd" — is
 * immediate here and impossible in a table of timestamps.
 */
export function ActivityHeatmap({
  days,
  weeks = 10,
  caption,
}: {
  days: Point[];
  weeks?: number;
  caption: string;
}) {
  const cell = 13;
  const gap = 3;
  const cols = weeks;
  const width = cols * (cell + gap) + 26;
  const height = 7 * (cell + gap) + 8;
  // Oldest first, left to right, matching how a calendar reads.
  const ordered = [...days].reverse().slice(-cols * 7);

  return (
    <figure className="chart-figure">
      <svg
        className="chart chart-heatmap"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={caption}
      >
        {ordered.map((d, i) => {
          const col = Math.floor(i / 7);
          const row = i % 7;
          const alpha = clamp(d.value, 0, 1);
          return (
            <rect
              key={d.label}
              x={col * (cell + gap) + 22}
              y={row * (cell + gap) + 4}
              width={cell}
              height={cell}
              rx={3}
              fill={alpha === 0 ? 'rgba(255,255,255,0.05)' : CYAN}
              opacity={alpha === 0 ? 1 : 0.25 + alpha * 0.75}
            >
              <title>{`${d.label}: ${d.value} lesson${d.value === 1 ? '' : 's'}`}</title>
            </rect>
          );
        })}
        {['M', 'W', 'F'].map((day, i) => (
          <text key={day} x={0} y={4 + [1, 3, 5][i]! * (cell + gap) + cell} className="chart-axis-label">
            {day}
          </text>
        ))}
      </svg>
      <DataTable
        caption={caption}
        valueLabel="Lessons"
        points={days.filter((d) => d.value > 0)}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                  */
/* -------------------------------------------------------------------------- */

/** A single number with a trend, used across the analytics header. */
export function StatTile({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: number[];
}) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {trend && trend.length > 1 && <Sparkline values={trend} label={label} />}
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}