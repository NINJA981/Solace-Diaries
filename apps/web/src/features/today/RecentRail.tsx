import { Link } from 'react-router';
import { MoodDot } from '@/components/ui';
import { relativeDay } from '../journal-core/format';
import { useEntries } from '../journal-core/queries';
import { InlineError } from '../journal-core/EntryCard';

/** The last few entries, slim enough to sit beside the editor. */
export function RecentRail({ today, excludeId }: { today: string; excludeId?: string }) {
  const q = useEntries({}, { limit: 6 });
  const items = (q.data?.pages[0]?.items ?? []).filter((e) => e.id !== excludeId).slice(0, 5);

  return (
    <section aria-labelledby="recent-heading">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="recent-heading" className="text-sm font-medium text-fg-muted">
          Recent
        </h2>
        <Link to="/app/journal" className="text-xs text-fg-faint underline-offset-2 hover:text-fg hover:underline">
          All entries
        </Link>
      </div>
      {q.isPending ? (
        <ul aria-hidden="true" className="space-y-4">
          {[0, 1, 2].map((i) => (
            <li key={i} className="space-y-1.5">
              <div className="h-3 w-16 animate-pulse rounded bg-sunken" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-sunken" />
            </li>
          ))}
        </ul>
      ) : q.isError ? (
        <InlineError message="Couldn’t load recent entries." onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm leading-relaxed text-fg-faint">Entries you write will collect here.</p>
      ) : (
        <ul className="-mx-2">
          {items.map((e) => (
            <li key={e.id}>
              <Link
                to={`/app/entries/${e.id}`}
                className="flex min-h-11 gap-3 rounded-control px-2 py-2 transition-colors hover:bg-surface"
              >
                <span aria-hidden="true" className="mt-1.5 inline-flex">
                  <MoodDot mood={e.mood} size={8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg-faint">{relativeDay(e.entryDate, today)}</span>
                  <span className="block truncate font-serif text-[0.98rem] text-fg">
                    {e.title.trim() || e.excerpt || 'Untitled'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
