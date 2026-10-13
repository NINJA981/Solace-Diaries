import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, daysBetween, type DayStat } from '@solace/shared';
import { monthLabelColumns, yearGrid, type HeatCell } from '../journal-core/dates';
import { formatLongDay, formatMonthShort, moodStep, plural } from '../journal-core/format';
import { useElementWidth } from './useElementWidth';

const GAP = 3;
/** Visible but recessive in both themes (a step off the page, from the hairline token). */
export const EMPTY_FILL = 'color-mix(in oklab, var(--line) 75%, transparent)';
const LABEL_W = 28;
const TOP = 18;
const MIN_CELL = 11;
const MAX_CELL = 15;

/** Fill for a day: mood valence when known, else lamp intensity by count, else empty. */
export function cellFill(d: DayStat | undefined): { fill: string; opacity: number } {
  if (!d || d.count === 0) return { fill: EMPTY_FILL, opacity: 1 };
  if (d.moodScore !== null) return { fill: `var(--mood-${moodStep(d.moodScore)})`, opacity: 1 };
  return { fill: 'var(--lamp)', opacity: d.count >= 3 ? 1 : d.count === 2 ? 0.7 : 0.45 };
}

export function cellLabel(date: string, d: DayStat | undefined): string {
  const day = formatLongDay(date);
  if (!d || d.count === 0) return `${day}: no entries`;
  return `${day}: ${plural(d.count, 'entry', 'entries')}${d.mood ? `, mostly ${d.mood}` : ''}`;
}

/**
 * A year of writing: one column per week (Monday first), one square per day. Fits as many
 * weeks as the width allows (a full year on desktop, recent months on a phone).
 * Keyboard: one tab stop; arrows move by day/week, Home/End jump to the ends.
 */
export const YearHeatmap = memo(function YearHeatmap({ days, today }: { days: DayStat[]; today: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const weeks = Math.max(13, Math.min(53, Math.floor((width - LABEL_W + GAP) / (MIN_CELL + GAP))));
  const cell = Math.min(MAX_CELL, Math.floor((width - LABEL_W + GAP) / weeks - GAP));
  const cells = useMemo(() => yearGrid(today, weeks).filter((c) => !c.future), [today, weeks]);
  const months = useMemo(() => monthLabelColumns(yearGrid(today, weeks)), [today, weeks]);
  const first = cells[0]?.date ?? today;
  const [active, setActive] = useState<string>(today);
  const [hover, setHover] = useState<HeatCell | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const step = cell + GAP;
  const svgW = LABEL_W + weeks * step - GAP;
  const svgH = TOP + 7 * step - GAP;
  const shown = hover ?? cells.find((c) => c.date === active) ?? null;
  const focusedInside = useRef(false);
  const [showTip, setShowTip] = useState(false);

  const move = (date: string) => {
    if (daysBetween(first, date) < 0 || daysBetween(date, today) < 0) return;
    setActive(date);
    requestAnimationFrame(() => svgRef.current?.querySelector<SVGRectElement>(`[data-date="${date}"]`)?.focus());
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const map: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    if (e.key in map) {
      e.preventDefault();
      move(addDays(active, map[e.key]!));
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(first);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(today);
    }
  };

  const activeLabel = shown ? cellLabel(shown.date, byDate.get(shown.date)) : '';
  const rows = useMemo(() => {
    const r: HeatCell[][] = [[], [], [], [], [], [], []];
    for (const c of cells) r[c.row]!.push(c);
    return r;
  }, [cells]);

  return (
    <div ref={ref} className="relative w-full">
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        role="grid"
        aria-label={`Days you wrote, last ${weeks === 53 ? '12 months' : `${weeks} weeks`}. Use arrow keys to move between days.`}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focusedInside.current = true;
          setShowTip(true);
        }}
        onBlur={() => {
          focusedInside.current = false;
          setShowTip(false);
        }}
        onPointerLeave={() => setHover(null)}
        className="block max-w-full overflow-visible"
      >
        {months.map((m) => (
          <text key={m.month} x={LABEL_W + m.col * step} y={11} className="fill-fg-faint text-[11px]" aria-hidden="true">
            {formatMonthShort(m.month)}
          </text>
        ))}
        {[
          ['Mon', 0],
          ['Wed', 2],
          ['Fri', 4],
        ].map(([label, row]) => (
          <text
            key={label}
            x={0}
            y={TOP + (row as number) * step + cell - 2}
            className="fill-fg-faint text-[10px]"
            aria-hidden="true"
          >
            {label}
          </text>
        ))}
        {rows.map((row, ri) => (
          <g role="row" key={ri}>
            {row.map((c) => {
              const d = byDate.get(c.date);
              const { fill, opacity } = cellFill(d);
              const isToday = c.date === today;
              return (
                <rect
                  key={c.date}
                  role="gridcell"
                  data-date={c.date}
                  tabIndex={c.date === active ? 0 : -1}
                  aria-label={cellLabel(c.date, d)}
                  aria-current={isToday ? 'date' : undefined}
                  x={LABEL_W + c.col * step}
                  y={TOP + c.row * step}
                  width={cell}
                  height={cell}
                  rx={3}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={isToday ? 'var(--fg)' : 'transparent'}
                  strokeWidth={isToday ? 1.5 : 0}
                  onPointerEnter={() => setHover(c)}
                  onFocus={() => setActive(c.date)}
                  onClick={() => setActive(c.date)}
                  className="cursor-default outline-none focus-visible:stroke-[var(--focus)] focus-visible:[stroke-width:2]"
                />
              );
            })}
          </g>
        ))}
      </svg>
      <p className="mt-3 min-h-5 text-sm text-fg-muted" aria-hidden={!hover && !showTip}>
        {hover || showTip ? activeLabel : ' '}
      </p>
    </div>
  );
});

export function HeatmapLegend() {
  const swatch = (style: React.CSSProperties) => <span className="inline-block size-3 rounded-[3px]" style={style} />;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-faint">
      <span className="inline-flex items-center gap-1.5">
        <span>Heavier</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} aria-hidden="true">
            {swatch({ background: `var(--mood-${n})` })}
          </span>
        ))}
        <span>Brighter</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">{swatch({ background: 'var(--lamp)', opacity: 0.7 })}</span>
        Wrote, no mood yet
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">{swatch({ background: EMPTY_FILL })}</span>
        No entry
      </span>
    </div>
  );
}
