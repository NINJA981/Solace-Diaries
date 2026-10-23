import { memo, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { WeekMood } from '@solace/shared';
import { VisuallyHidden } from '@/components/ui';
import { formatMonthShort, formatShortDay, moodStep, plural } from '../journal-core/format';
import { BANDS, describeAvg, niceMax, toWeekRows, type WeekRow } from './moodData';
import { useElementWidth } from './useElementWidth';

const LEFT = 52;
const RIGHT = 8;
const LINE_H = 150;
const GAP_H = 28;
const BAR_H = 72;
const AXIS_H = 22;
const PAD_T = 10;

/** A path for a column whose top corners are rounded and baseline is square. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function weekLabel(r: WeekRow): string {
  const mood = r.avg === null ? 'no moods recorded' : `${describeAvg(r.avg)} (average ${r.avg > 0 ? '+' : ''}${r.avg.toFixed(1)})`;
  const counts = r.total
    ? BANDS.filter((b) => r[b.key] > 0)
        .map((b) => `${r[b.key]} ${b.label.toLowerCase()}`)
        .join(', ')
    : 'no entries with a mood';
  return `Week of ${formatShortDay(r.weekStart)}: ${mood}; ${counts}.`;
}

/**
 * Mood over the last 26 weeks as two aligned panels on one time axis (never two y-scales):
 *  1. average valence per week, a 2px line on a −2…+2 scale with a neutral baseline;
 *  2. how many moods were logged each week, stacked by band (heavy / steady / bright).
 * One crosshair reads both panels; arrow keys step through weeks; a table mirrors it all.
 */
export const MoodChart = memo(function MoodChart({ trend }: { trend: WeekMood[] }) {
  const rows = useMemo(() => toWeekRows(trend), [trend]);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = rows.length;
  const plotW = Math.max(120, width - LEFT - RIGHT);
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(3, Math.min(24, slot * 0.62));
  const cx = (i: number) => LEFT + slot * i + slot / 2;
  const yScore = (s: number) => PAD_T + ((2 - s) / 4) * LINE_H;
  const barTop = PAD_T + LINE_H + GAP_H;
  const maxCount = niceMax(Math.max(1, ...rows.map((r) => r.total)));
  const yCount = (c: number) => (c / maxCount) * BAR_H;
  const height = barTop + BAR_H + AXIS_H;

  // Line segments break where a week has no moods.
  const segments = useMemo(() => {
    const segs: string[] = [];
    let cur = '';
    rows.forEach((r, i) => {
      if (r.avg === null) {
        if (cur) segs.push(cur);
        cur = '';
        return;
      }
      cur += `${cur ? 'L' : 'M'}${cx(i).toFixed(1)},${yScore(r.avg).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, slot]);

  const monthTicks = useMemo(() => {
    const ticks: { i: number; label: string }[] = [];
    let last = '';
    rows.forEach((r, i) => {
      const m = r.weekStart.slice(0, 7);
      if (m !== last) {
        last = m;
        ticks.push({ i, label: formatMonthShort(r.weekStart) });
      }
    });
    // Keep labels from colliding on narrow screens.
    const minGap = 34;
    return ticks.filter((t, k) => k === 0 || (t.i - ticks[k - 1]!.i) * slot >= minGap);
  }, [rows, slot]);

  const lastWithAvg = [...rows].reverse().find((r) => r.avg !== null);
  const lastIdx = lastWithAvg ? rows.lastIndexOf(lastWithAvg) : -1;

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - LEFT;
    const i = Math.floor(x / slot);
    setActive(i >= 0 && i < n ? i : null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const base = active ?? (e.key === 'ArrowLeft' ? n : -1);
      setActive(Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
  };

  const a = active !== null ? rows[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(cx(active), 110), width - 110) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-fg-muted" />
          Average mood
        </span>
        {BANDS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-xs" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label="Mood by week, last 26 weeks. Use left and right arrow keys to read each week."
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative rounded-control"
      >
        <svg width={width} height={height} onPointerMove={onPointer} onPointerLeave={() => setActive(null)} aria-hidden="true" className="block max-w-full touch-pan-y">
          {/* Valence scale: hairline grid, neutral baseline slightly stronger. */}
          {[2, 1, 0, -1, -2].map((s) => (
            <line
              key={s}
              x1={LEFT}
              x2={LEFT + plotW}
              y1={yScore(s)}
              y2={yScore(s)}
              stroke={s === 0 ? 'var(--line-strong)' : 'var(--line)'}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}
          {[
            [2, 'Bright'],
            [0, 'Steady'],
            [-2, 'Heavy'],
          ].map(([s, label]) => (
            <text key={label} x={LEFT - 8} y={yScore(s as number) + 4} textAnchor="end" className="fill-fg-faint text-caption">
              {label}
            </text>
          ))}

          {active !== null && (
            <line x1={cx(active)} x2={cx(active)} y1={PAD_T} y2={barTop + BAR_H} stroke="var(--line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
          )}

          {segments.map((d) => (
            <path key={d} d={d} fill="none" stroke="var(--fg-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {rows.map((r, i) =>
            r.avg === null ? null : (
              <circle
                key={r.weekStart}
                cx={cx(i)}
                cy={yScore(r.avg)}
                r={i === active || i === lastIdx ? 5 : 3.5}
                fill={`var(--mood-${moodStep(r.avg)})`}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ),
          )}

          {/* Counts per week, stacked heavy → steady → bright from the baseline, 2px surface gaps. */}
          <line x1={LEFT} x2={LEFT + plotW} y1={barTop + BAR_H} y2={barTop + BAR_H} stroke="var(--line)" shapeRendering="crispEdges" />
          <text x={LEFT - 8} y={barTop + 8} textAnchor="end" className="fill-fg-faint text-caption tabular-nums">
            {maxCount}
          </text>
          <text x={LEFT - 8} y={barTop + BAR_H} textAnchor="end" className="fill-fg-faint text-caption tabular-nums">
            0
          </text>
          {rows.map((r, i) => {
            let y = barTop + BAR_H;
            const x = cx(i) - barW / 2;
            const parts = BANDS.filter((b) => r[b.key] > 0);
            return (
              <g key={r.weekStart} opacity={active === null || active === i ? 1 : 0.72}>
                {parts.map((b, k) => {
                  const h = yCount(r[b.key]);
                  const gap = k < parts.length - 1 ? 2 : 0;
                  y -= h;
                  const isTop = k === parts.length - 1;
                  const segH = Math.max(1, h - gap);
                  return isTop ? (
                    <path key={b.key} d={topRounded(x, y, barW, segH, 4)} fill={b.color} />
                  ) : (
                    <rect key={b.key} x={x} y={y + gap} width={barW} height={segH} fill={b.color} />
                  );
                })}
              </g>
            );
          })}
          {monthTicks.map((t) => (
            <text key={t.i} x={LEFT + slot * t.i + 1} y={height - 6} className="fill-fg-faint text-caption">
              {t.label}
            </text>
          ))}
        </svg>

        {a && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-52 -translate-x-1/2 rounded-control border border-line-strong bg-raised px-3 py-2 text-xs shadow-1"
            style={{ left: tipLeft }}
          >
            <p className="text-fg-faint">Week of {formatShortDay(a.weekStart)}</p>
            <p className="mt-0.5 text-sm font-semibold text-fg">
              {a.avg === null ? 'No moods' : describeAvg(a.avg).replace(/^./, (c) => c.toUpperCase())}
            </p>
            {a.total > 0 && (
              <ul className="mt-1 space-y-0.5">
                {BANDS.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-3 text-fg-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3 rounded" style={{ background: b.color }} />
                      {b.label}
                    </span>
                    <span className="font-medium text-fg tabular-nums">{a[b.key]}</span>
                  </li>
                ))}
              </ul>
            )}
            <VisuallyHidden>{weekLabel(a)}</VisuallyHidden>
          </div>
        )}
      </div>

      <details className="mt-4 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-fg-muted hover:text-fg sm:min-h-0">Show as a table</summary>
        <div className="mt-3 max-h-80 overflow-auto rounded-control border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Mood by week</caption>
            <thead className="sticky top-0 bg-surface text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Week of</th>
                <th scope="col" className="px-3 py-2 font-medium">Average</th>
                {BANDS.map((b) => (
                  <th key={b.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.weekStart} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 font-normal text-fg">
                    {formatShortDay(r.weekStart)}
                  </th>
                  <td className="px-3 py-1.5 text-fg-muted">
                    {r.avg === null ? '—' : `${r.avg > 0 ? '+' : ''}${r.avg.toFixed(1)} (${describeAvg(r.avg)})`}
                  </td>
                  {BANDS.map((b) => (
                    <td key={b.key} className="px-3 py-1.5 text-right text-fg-muted">
                      {r[b.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="sr-only">{plural(rows.filter((r) => r.total > 0).length, 'week')} with moods in the last 26 weeks.</p>
    </div>
  );
});
