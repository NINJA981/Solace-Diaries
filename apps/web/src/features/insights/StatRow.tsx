import type { Stats } from '@solace/shared';
import { compactNumber } from '../journal-core/format';

/** Four quiet figures in one row: proportional numerals, sans, labels underneath. */
export function StatRow({ stats }: { stats: Stats }) {
  const items = [
    { label: stats.currentStreak === 1 ? 'Day streak' : 'Days in a row', value: stats.currentStreak },
    { label: 'Longest streak', value: stats.longestStreak },
    { label: stats.totalEntries === 1 ? 'Entry' : 'Entries', value: stats.totalEntries },
    { label: 'Words written', value: stats.totalWords },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col-reverse gap-0.5 border-l border-line pl-4 first:border-lamp/70">
          <dt className="text-sm text-fg-muted">{i.label}</dt>
          <dd className="text-3xl font-semibold tracking-tight text-fg">{compactNumber(i.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatRowSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2 border-l border-line pl-4">
          <div className="h-8 w-14 animate-pulse rounded bg-sunken" />
          <div className="h-4 w-24 animate-pulse rounded bg-sunken" />
        </div>
      ))}
    </div>
  );
}
