import { clsx } from 'clsx';
import { EmptyState } from '@/components/ui';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { EntryCard, EntryCardSkeleton, InlineError } from '../journal-core/EntryCard';
import { Highlighted } from '../journal-core/Highlighted';
import { plural } from '../journal-core/format';
import { useSearch, type EntryFilters, type SearchMode } from '../journal-core/queries';
import { Search } from 'lucide-react';

type Props = {
  q: string;
  mode: SearchMode;
  filters: EntryFilters;
  today: string;
  onMode: (m: SearchMode) => void;
};

export function SearchResults({ q, mode, filters, today, onMode }: Props) {
  const search = useSearch(q, mode, filters);
  const hits = search.data?.hits ?? [];
  const other: SearchMode = mode === 'hybrid' ? 'keyword' : 'hybrid';
  const switchLabel = other === 'keyword' ? 'Search exact words instead' : 'Search by meaning instead';

  let body: React.ReactNode;
  if (search.isPending) {
    body = (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <EntryCardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (search.isError) {
    const aiDown =
      search.error instanceof ApiRequestError &&
      (search.error.code === 'ai_unavailable' || search.error.code === 'ai_quota_exceeded' || search.error.status === 503);
    body = (
      <div className="space-y-3">
        <InlineError
          message={
            aiDown && mode === 'hybrid'
              ? 'Searching by meaning isn’t available right now. Exact-word search still works.'
              : errorMessage(search.error)
          }
          onRetry={() => void search.refetch()}
        />
        {mode === 'hybrid' && (
          <button type="button" onClick={() => onMode('keyword')} className="text-sm font-medium text-lamp underline underline-offset-2">
            Search exact words instead
          </button>
        )}
      </div>
    );
  } else if (hits.length === 0) {
    body = (
      <EmptyState
        icon={<Search />}
        title="No entries match"
        description={
          mode === 'keyword'
            ? 'None of your entries use those exact words. Searching by meaning can find related moments.'
            : 'Nothing close to that yet. Try fewer words, or loosen the filters.'
        }
        action={
          <button type="button" onClick={() => onMode(other)} className="text-sm font-medium text-lamp underline underline-offset-2">
            {switchLabel}
          </button>
        }
      />
    );
  } else {
    body = (
      <ul className={clsx('space-y-3 transition-opacity', search.isPlaceholderData && 'opacity-60')}>
        {hits.map((h) => {
          const byMeaningOnly = h.matchedBy.includes('meaning') && !h.matchedBy.includes('keyword');
          return (
            <li key={h.entry.id}>
              <EntryCard
                entry={h.entry}
                today={today}
                headingLevel="h2"
                snippet={<Highlighted text={h.snippet} query={q} />}
                footnote={byMeaningOnly ? <span className="text-dusk">Matched by meaning</span> : undefined}
              />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-label="Search results">
      <p role="status" aria-live="polite" className="mb-3 min-h-5 text-sm text-fg-faint">
        {search.isSuccess && !search.isPlaceholderData
          ? hits.length
            ? `${plural(hits.length, 'entry', 'entries')} found`
            : ''
          : search.isFetching
            ? 'Searching…'
            : ''}
      </p>
      {body}
    </section>
  );
}
