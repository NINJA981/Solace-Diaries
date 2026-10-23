import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MOOD_SCORE, addDays, daysBetween, type EntrySummary, type Mood } from '@solace/shared';
import { IconButton } from '@/components/ui';
import { addMonths, monthEnd, monthGrid, monthStart } from '../journal-core/dates';
import { EntryCard, InlineError } from '../journal-core/EntryCard';
import { formatLongDay, formatMonth, moodStep, plural } from '../journal-core/format';
import { useEntries, type EntryFilters } from '../journal-core/queries';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type DaySummary = { count: number; score: number | null; mood: Mood | null; moods: (Mood | null)[] };

/** Per-day count, average valence and most frequent mood for a month of entries. */
export function summarizeDays(items: EntrySummary[]): Map<string, DaySummary> {
  const acc = new Map<string, { count: number; scores: number[]; moods: Map<Mood, number>; list: (Mood | null)[] }>();
  for (const e of items) {
    const d = acc.get(e.entryDate) ?? { count: 0, scores: [] as number[], moods: new Map<Mood, number>(), list: [] as (Mood | null)[] };
    d.count++;
    d.list.push(e.mood);
    if (e.mood) {
      d.scores.push(MOOD_SCORE[e.mood]);
      d.moods.set(e.mood, (d.moods.get(e.mood) ?? 0) + 1);
    }
    acc.set(e.entryDate, d);
  }
  const out = new Map<string, DaySummary>();
  for (const [date, d] of acc) {
    const top = [...d.moods.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(date, {
      count: d.count,
      score: d.scores.length ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : null,
      mood: top ? top[0] : null,
      moods: d.list,
    });
  }
  return out;
}

type Props = {
  month: string; // YYYY-MM-01
  day: string | undefined;
  today: string;
  filters: EntryFilters;
  /** Change month, optionally selecting a day in it (one URL update). */
  onMonth: (month: string, day?: string) => void;
  onDay: (day: string | undefined) => void;
};

/** Month grid; days with entries are tinted by mood. Arrow keys move between days. */
export function CalendarView({ month, day, today, filters, onMonth, onDay }: Props) {
  const from = monthStart(month);
  const to = monthEnd(month);
  const q = useEntries({ mood: filters.mood, tag: filters.tag, from, to }, { limit: 50 });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  // A month rarely exceeds one page, but fetch the rest so every day is accurate.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const days = useMemo(() => summarizeDays(items), [items]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const gridRef = useRef<HTMLDivElement>(null);

  const focusDate =
    day && day.slice(0, 7) === month.slice(0, 7)
      ? day
      : today.slice(0, 7) === month.slice(0, 7)
        ? today
        : from;
  const isFuture = (d: string) => daysBetween(today, d) > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const date = target.dataset.date;
    if (!date) return;
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (e.key in delta) next = addDays(date, delta[e.key]!);
    else if (e.key === 'Home') next = monthStart(date);
    else if (e.key === 'End') next = monthEnd(date);
    if (!next) return;
    e.preventDefault();
    if (next.slice(0, 7) !== month.slice(0, 7)) {
      onMonth(monthStart(next), next);
    }
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  };

  const dayEntries = day ? items.filter((e) => e.entryDate === day) : [];
  const canGoNext = daysBetween(addMonths(month, 1), today) >= 0;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-10">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="type-heading text-xl text-fg" aria-live="polite">
            {formatMonth(month)}
          </h2>
          <div className="flex gap-1">
            <IconButton label="Previous month" icon={<ChevronLeft className="size-4" />} onClick={() => onMonth(addMonths(month, -1))} />
            <IconButton
              label="Next month"
              icon={<ChevronRight className="size-4" />}
              onClick={() => onMonth(addMonths(month, 1))}
              disabled={!canGoNext}
            />
          </div>
        </div>
        {q.isError ? (
          <InlineError message="Couldn’t load this month." onRetry={() => void q.refetch()} />
        ) : (
          <div
            ref={gridRef}
            role="grid"
            aria-label={`Entries in ${formatMonth(month)}`}
            aria-busy={q.isPending}
            onKeyDown={onKeyDown}
            className={clsx('transition-opacity', q.isFetching && 'opacity-70')}
          >
            <div role="row" className="grid grid-cols-7 gap-1 pb-1">
              {WEEKDAYS.map((w) => (
                <span key={w} role="columnheader" className="py-1 text-center text-xs text-fg-faint">
                  <abbr title={w} className="no-underline">
                    {w.slice(0, 2)}
                  </abbr>
                </span>
              ))}
            </div>
            {weeks.map((week) => (
              <div role="row" key={week[0]!.date} className="grid grid-cols-7 gap-1 pb-1">
                {week.map((c) => {
                  if (!c.inMonth) return <span role="gridcell" key={c.date} aria-hidden="true" />;
                  const s = days.get(c.date);
                  const future = isFuture(c.date);
                  const selected = c.date === day;
                  const label = `${formatLongDay(c.date)}: ${
                    s ? `${plural(s.count, 'entry', 'entries')}${s.mood ? `, mostly ${s.mood}` : ''}` : 'no entries'
                  }`;
                  return (
                    <span role="gridcell" key={c.date} aria-selected={selected}>
                      <button
                        type="button"
                        data-date={c.date}
                        tabIndex={c.date === focusDate ? 0 : -1}
                        disabled={future}
                        aria-label={label}
                        aria-current={c.date === today ? 'date' : undefined}
                        onClick={() => onDay(selected ? undefined : c.date)}
                        className={clsx(
                          'relative flex aspect-square w-full min-h-11 flex-col items-center justify-center gap-1 rounded-control text-sm tabular-nums transition-colors',
                          s ? 'border border-line bg-raised font-medium text-fg hover:border-line-strong' : 'text-fg-muted hover:bg-surface',
                          future && 'cursor-default text-fg-faint/50 hover:bg-transparent',
                          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
                          c.date === today && !selected && 'ring-1 ring-line-strong',
                        )}
                      >
                        <span className="leading-none">{Number(c.date.slice(8))}</span>
                        {s && (
                          <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                            {s.moods.slice(0, 3).map((m, i) => (
                              <span
                                key={i}
                                className="size-1.5 rounded-full"
                                style={{ background: m ? `var(--mood-${moodStep(MOOD_SCORE[m])})` : 'var(--fg-faint)' }}
                              />
                            ))}
                          </span>
                        )}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-fg-faint">
          Each dot is an entry, colored by its mood: cool for heavier days, warm for brighter ones.
        </p>
      </div>

      <section aria-live="polite" aria-label={day ? `Entries on ${formatLongDay(day)}` : 'Selected day'} className="mt-8 lg:mt-0">
        {day ? (
          <>
            <h2 className="mb-3 type-heading text-xl text-fg">{formatLongDay(day)}</h2>
            {q.isPending ? null : dayEntries.length ? (
              <ul className="space-y-3">
                {dayEntries.map((e) => (
                  <li key={e.id}>
                    <EntryCard entry={e} today={today} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nothing written on this day.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-fg-faint lg:pt-12">
            Choose a day to see what you wrote. {items.length ? `${plural(items.length, 'entry', 'entries')} this month.` : ''}
          </p>
        )}
      </section>
    </div>
  );
}

