import { useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import type { EntrySummary } from '@solace/shared';
import { Button } from '@/components/ui';
import { EntryCard, EntryCardSkeleton, InlineError } from '../journal-core/EntryCard';
import { formatMonth } from '../journal-core/format';
import { useEntries, type EntryFilters } from '../journal-core/queries';
import '../journal-core/journal.css';

export function groupByMonth(items: EntrySummary[]): { month: string; items: EntrySummary[] }[] {
  const groups: { month: string; items: EntrySummary[] }[] = [];
  for (const e of items) {
    const m = e.entryDate.slice(0, 7);
    const last = groups.at(-1);
    if (last && last.month === m) last.items.push(e);
    else groups.push({ month: m, items: [e] });
  }
  return groups;
}

type Props = { filters: EntryFilters; today: string; empty: React.ReactNode };

/** Infinite, month-grouped list of entries. The "Load more" button doubles as the scroll sentinel. */
export function Timeline({ filters, today, empty }: Props) {
  const q = useEntries(filters);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const groups = useMemo(() => groupByMonth(items), [items]);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (q.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading entries">
        {[0, 1, 2, 3].map((i) => (
          <EntryCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (q.isError) return <InlineError message="Couldn’t load your entries." onRetry={() => void q.refetch()} />;
  if (items.length === 0) return <>{empty}</>;

  return (
    <div className={clsx('space-y-10 transition-opacity', q.isFetching && !isFetchingNextPage && 'opacity-70')}>
      {groups.map((g, i) => (
        <section key={g.month} aria-labelledby={`month-${g.month}`} className={i > 1 ? 'journal-month-deferred' : undefined}>
          <h2
            id={`month-${g.month}`}
            className="sticky top-14 z-10 -mx-1 mb-3 bg-ink/90 px-1 py-2 font-serif text-lg text-fg-muted backdrop-blur md:top-0"
          >
            {formatMonth(g.month)}
          </h2>
          <ul className="space-y-3">
            {g.items.map((e) => (
              <li key={e.id}>
                <EntryCard entry={e} today={today} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinel} className="flex justify-center pt-2">
        {hasNextPage ? (
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? 'Loading older entries…' : 'Load older entries'}
          </Button>
        ) : (
          items.length > 6 && <p className="text-sm text-fg-faint">That’s the very first entry.</p>
        )}
      </div>
    </div>
  );
}
