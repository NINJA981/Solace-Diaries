import { useCallback } from 'react';
import { Link } from 'react-router';
import { BookOpen, Feather } from 'lucide-react';
import { localDate } from '@solace/shared';
import { EmptyState, Tabs, buttonClasses } from '@/components/ui';
import { useTimezone } from '@/lib/session';
import { useDraftSync } from '../journal-core/editor/useDraftSync';
import { monthStart } from '../journal-core/dates';
import { useStats, type SearchMode } from '../journal-core/queries';
import { CalendarView } from './CalendarView';
import { Filters } from './Filters';
import { SearchBar } from './SearchBar';
import { SearchResults } from './SearchResults';
import { Timeline } from './Timeline';
import { useJournalParams, type JournalView } from './useJournalParams';

export default function JournalPage() {
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const { q, mode, view, filters, hasFilters, month, day, update } = useJournalParams();
  const stats = useStats(tz);
  useDraftSync();

  const onQuery = useCallback((value: string) => update({ q: value.trim() || undefined }), [update]);
  const onMode = useCallback((m: SearchMode) => update({ mode: m === 'keyword' ? 'keyword' : undefined }), [update]);
  const clearFilters = () => update({ mood: undefined, tag: undefined, from: undefined, to: undefined });
  const searching = q.trim().length > 0;
  const calMonth = month ? `${month}-01` : monthStart(today);

  const emptyJournal = hasFilters ? (
    <EmptyState
      icon={<BookOpen />}
      title="Nothing matches these filters"
      description="Try a different mood, tag or time range."
      action={
        <button type="button" onClick={clearFilters} className={buttonClasses('secondary')}>
          Clear filters
        </button>
      }
    />
  ) : (
    <EmptyState
      icon={<Feather />}
      title="Your journal is empty"
      description="Everything you write lands here, newest first. Solace starts noticing patterns after a few entries."
      action={
        <Link to="/app/today" className={buttonClasses('primary')}>
          Write your first entry
        </Link>
      }
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
      <h1 className="mb-6 font-serif text-3xl text-fg sm:text-4xl">Journal</h1>

      <div className="space-y-3">
        <SearchBar q={q} mode={mode} onQuery={onQuery} onMode={onMode} />
        <Filters
          filters={filters}
          tags={stats.data?.topTags.map((t) => t.tag) ?? []}
          today={today}
          onChange={(patch) => update(patch)}
          onClear={clearFilters}
          showDates={searching || view === 'timeline'}
        />
      </div>

      <div className="mt-8">
        {searching ? (
          <SearchResults q={q} mode={mode} filters={filters} today={today} onMode={onMode} />
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <Tabs
                label="View"
                idPrefix="journal-view"
                value={view}
                onValueChange={(v) => update({ view: (v as JournalView) === 'calendar' ? 'calendar' : undefined })}
                items={[
                  { value: 'timeline', label: 'Timeline', controls: 'journal-panel' },
                  { value: 'calendar', label: 'Calendar', controls: 'journal-panel' },
                ]}
              />
            </div>
            <div id="journal-panel" role="tabpanel" aria-labelledby={`journal-view-${view}`}>
              {view === 'calendar' ? (
                <CalendarView
                  month={calMonth}
                  day={day}
                  today={today}
                  filters={filters}
                  onMonth={(m, d) => update({ month: m.slice(0, 7), day: d })}
                  onDay={(d) => update({ day: d })}
                />
              ) : (
                <Timeline filters={filters} today={today} empty={emptyJournal} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
