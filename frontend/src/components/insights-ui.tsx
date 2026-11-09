/* ==========================================================================
   The platform's growth screens: the period, the figures strip, the website
   traffic chart and the subscription mix bar
   --------------------------------------------------------------------------
   Charts follow the house rules: one series is a 2px line over a 10% wash
   on a zero baseline with hairline gridlines and a crosshair tooltip (the
   arrow keys walk it too); the mix is a thin segmented bar, 2px surface gaps
   between parts, with the legend — names, counts and shares — as its table.
   Colours come from insights.css, validated for colour-blind readers in
   light and dark (see the comment there). Text never wears a series colour.
   ========================================================================== */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Button, Menu, MenuItem } from './ui';
import { number } from '../utils/format';

/* ------------------------------------------------------------- the period */

const DAY = 86_400_000;
/** Today in Pakistan, as the server counts days. */
export const pkToday = (): string => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);
const monthStart = (day: string, back = 0): string => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10);
};

export type RangePreset = '7' | '30' | '90' | 'month' | 'last-month' | 'custom';
export interface Range { preset: RangePreset; from: string; to: string }

const PRESETS: { value: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' }
];

export function presetRange(preset: Exclude<RangePreset, 'custom'>): Range {
  const today = pkToday();
  if (preset === 'month') return { preset, from: monthStart(today), to: today };
  if (preset === 'last-month') return { preset, from: monthStart(today, 1), to: shift(monthStart(today), -1) };
  return { preset, from: shift(today, -(Number(preset) - 1)), to: today };
}

/** "10 Oct – 08 Nov 2026" */
export function rangeLabel(range: { from: string; to: string }): string {
  const parse = (day: string) => new Date(`${day}T00:00:00Z`);
  const short = (day: string, year: boolean) => parse(day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${short(range.from, !sameYear)} – ${short(range.to, true)}`;
}

/** "8 November" */
export const dayLabel = (day: string, style: 'long' | 'short' = 'long'): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: style, timeZone: 'UTC' });

export const rangeQuery = (range: { from: string; to: string }): string => `from=${range.from}&to=${range.to}`;

export function useRange(initial: Exclude<RangePreset, 'custom'> = '30') {
  return useState<Range>(() => presetRange(initial));
}

/** The calendar button: a quick period, or any two dates up to a year apart. */
export function RangeMenu({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  useEffect(() => { setFrom(value.from); setTo(value.to); }, [value.from, value.to]);
  const span = (Date.parse(to) - Date.parse(from)) / DAY;
  const valid = !!from && !!to && from <= to && span <= 365;
  return (
    <Menu
      panel
      label="Choose the period"
      trigger={({ toggle, props }) => (
        <button type="button" className="range-button" onClick={toggle} {...props}>
          <CalendarDays size={17} aria-hidden="true" />
          <span>{rangeLabel(value)}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="range-panel">
          {PRESETS.map((preset) => (
            <MenuItem key={preset.value} selected={value.preset === preset.value} onClick={() => { onChange(presetRange(preset.value)); close(); }}>
              {preset.label}
            </MenuItem>
          ))}
          <div className="range-custom">
            <span className="range-custom-title">Dates</span>
            <div className="range-custom-row">
              <input className="input" type="date" value={from} max={to} aria-label="From" onChange={(event) => setFrom(event.target.value)} />
              <span aria-hidden="true">–</span>
              <input className="input" type="date" value={to} min={from} max={pkToday()} aria-label="To" onChange={(event) => setTo(event.target.value)} />
            </div>
            {!valid && from && to && <span className="range-custom-error">Choose a period of a year or less, start before end.</span>}
            <Button size="sm" variant="primary" disabled={!valid} onClick={() => { onChange({ preset: 'custom', from, to }); close(); }}>Show these dates</Button>
          </div>
        </div>
      )}
    </Menu>
  );
}

/* ---------------------------------------------------------- figures strip */

export interface Kpi { key: string; icon: ReactNode; label: string; value: number | string; hint: string; onClick?: () => void }

export function KpiStrip({ items, label }: { items: Kpi[]; label: string }) {
  return (
    <section className={`kpi-strip cols-${items.length}`} style={{ ['--kpi-cols' as string]: items.length }} aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            <span className="kpi-label"><span aria-hidden="true">{item.icon}</span>{item.label}</span>
            <strong className="kpi-value">{typeof item.value === 'number' ? number(item.value) : item.value}</strong>
            <span className="kpi-hint">{item.hint}</span>
          </>
        );
        return item.onClick
          ? <button key={item.key} type="button" className="kpi-cell is-link" onClick={item.onClick}>{body}</button>
          : <div key={item.key} className="kpi-cell">{body}</div>;
      })}
    </section>
  );
}

/* ---------------------------------------------------------- traffic chart */

/** Round up to a clean axis maximum: 568 → 600, 43 → 50, 7 → 8. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

/* A monotone curve through the points (Fritsch–Carlson): smooth like the
   design, and never dipping below zero or overshooting a peak. */
function monotonePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return points.length ? `M${points[0].x},${points[0].y}` : '';
  const n = points.length;
  const dx = points.slice(1).map((point, index) => point.x - points[index].x);
  const slope = points.slice(1).map((point, index) => (point.y - points[index].y) / (dx[index] || 1));
  const tangent = points.map((_, index) => {
    if (index === 0) return slope[0];
    if (index === n - 1) return slope[n - 2];
    return slope[index - 1] * slope[index] <= 0 ? 0 : (slope[index - 1] + slope[index]) / 2;
  });
  for (let index = 0; index < n - 1; index += 1) {
    if (slope[index] === 0) { tangent[index] = 0; tangent[index + 1] = 0; continue; }
    const a = tangent[index] / slope[index];
    const b = tangent[index + 1] / slope[index];
    const h = Math.hypot(a, b);
    if (h > 3) { tangent[index] = (3 / h) * a * slope[index]; tangent[index + 1] = (3 / h) * b * slope[index]; }
  }
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < n - 1; index += 1) {
    const third = dx[index] / 3;
    path += ` C${points[index].x + third},${points[index].y + tangent[index] * third} ${points[index + 1].x - third},${points[index + 1].y - tangent[index + 1] * third} ${points[index + 1].x},${points[index + 1].y}`;
  }
  return path;
}

/**
 * Unique visitors per day: one series, so the title names it (the small key
 * mirrors the design). Hover or the arrow keys show a day's figure.
 */
export function TrafficChart({ data, unit = 'visitors', height = 240 }: { data: { day: string; value: number }[]; unit?: string; height?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const left = 44;
    const right = 14;
    const top = 12;
    const bottom = 30;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const max = niceMax(Math.max(...data.map((row) => row.value), 0));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => Math.round(max * share));
    const x = (index: number) => left + (data.length <= 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
    const y = (value: number) => top + innerH - (value / max) * innerH;
    const points = data.map((row, index) => ({ x: x(index), y: y(row.value) }));
    const line = monotonePath(points);
    const base = top + innerH;
    const area = points.length ? `${line} L${points.at(-1)!.x},${base} L${points[0].x},${base} Z` : '';
    /* About five dates along the bottom, always the first and the last. */
    const every = Math.max(1, Math.ceil(data.length / 5));
    const labels = data.map((row, index) => ({ index, day: row.day })).filter((row) => row.index % every === 0 || row.index === data.length - 1)
      .filter((row, index, all) => index === all.length - 1 || all[all.length - 1].index - row.index >= every / 2);
    return { left, right, top, innerW, innerH, ticks, max, x, y, points, line, area, base, labels };
  }, [data, width, height]);

  const pick = (clientX: number) => {
    const box = holder.current?.getBoundingClientRect();
    if (!box || !data.length) return;
    const relative = clientX - box.left - geometry.left;
    const index = Math.round((relative / Math.max(1, geometry.innerW)) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, index)));
  };

  const shown = active !== null ? data[active] : null;
  const last = data.at(-1);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="viz viz-traffic" ref={holder}>
      <svg
        width={width} height={height} role="img" tabIndex={0}
        aria-label={`${unit} per day, ${data.length} days: ${number(total)} in all${last ? `, ${number(last.value)} on ${dayLabel(last.day)}` : ''}. Use the arrow keys to read each day.`}
        onMouseMove={(event) => pick(event.clientX)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? data.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); setActive((current) => Math.max(0, (current ?? data.length) - 1)); }
          if (event.key === 'ArrowRight') { event.preventDefault(); setActive((current) => Math.min(data.length - 1, (current ?? -1) + 1)); }
        }}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid" x1={geometry.left} x2={width - geometry.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
            <text className="viz-axis" x={geometry.left - 8} y={geometry.y(tick)} dy="0.32em" textAnchor="end">{number(tick)}</text>
          </g>
        ))}
        {geometry.labels.map((row) => (
          <text key={row.day} className="viz-axis" x={geometry.x(row.index)} y={geometry.base + 20}
            textAnchor={row.index === 0 ? 'start' : row.index === data.length - 1 ? 'end' : 'middle'}>
            {dayLabel(row.day, 'short')}
          </text>
        ))}
        <path className="viz-area" d={geometry.area} />
        <path className="viz-line" d={geometry.line} />
        {shown && active !== null && (
          <line className="viz-crosshair" x1={geometry.points[active].x} x2={geometry.points[active].x} y1={geometry.top} y2={geometry.base} />
        )}
        {geometry.points.length > 0 && (
          <circle className="viz-dot" cx={geometry.points[active ?? geometry.points.length - 1].x} cy={geometry.points[active ?? geometry.points.length - 1].y} r={4.5} />
        )}
      </svg>
      {shown && active !== null && (
        <div
          className="viz-tooltip" role="status"
          style={{ left: Math.min(Math.max(geometry.points[active].x, 70), width - 70), top: Math.max(geometry.points[active].y - 12, 0) }}
        >
          <strong>{number(shown.value)}</strong> {unit}<span>{dayLabel(shown.day)}</span>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- subscription mix */

export interface MixItem { key: string; label: string; count: number; percent: number }

/** The plans running today, as one thin bar split by category, with its legend-table. */
export function MixBar({ items, total }: { items: MixItem[]; total: number }) {
  const parts = items.filter((item) => item.count > 0);
  return (
    <div className="viz viz-mix">
      <div className="mix-bar" role="img" aria-label={parts.map((item) => `${item.label} ${item.count} (${item.percent}%)`).join(', ') || 'No plans running'}>
        {parts.length === 0 && <span className="mix-empty" />}
        {parts.map((item) => (
          <span key={item.key} className={`mix-part mix-${item.key}`} style={{ flexGrow: item.count }} title={`${item.label}: ${number(item.count)} (${item.percent}%)`} />
        ))}
      </div>
      <table className="mix-legend">
        <caption className="sr-only">Plans running today, of {number(total)}</caption>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <th scope="row"><span className={`mix-key mix-${item.key}`} aria-hidden="true" />{item.label}</th>
              <td className="num t-semi">{number(item.count)}</td>
              <td className="num t-dim">{item.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
