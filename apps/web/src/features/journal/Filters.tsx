import { useId } from 'react';
import { MOODS } from '@solace/shared';
import { Select } from '@/components/ui';
import { moodLabel } from '../journal-core/format';
import type { EntryFilters } from '../journal-core/queries';
import { presetFor, rangeForPreset, type DatePreset } from './useJournalParams';

type Props = {
  filters: EntryFilters;
  tags: string[];
  today: string;
  onChange: (patch: Partial<Record<keyof EntryFilters, string | undefined>>) => void;
  onClear: () => void;
  showDates?: boolean;
};

const dateInput =
  'h-11 rounded-control border border-line bg-sunken px-2 text-sm text-fg hover:border-line-strong sm:h-10';

/** Mood, tag and date filters in one compact row; they scope the search and the timeline alike. */
export function Filters({ filters, tags, today, onChange, onClear, showDates = true }: Props) {
  const fromId = useId();
  const toId = useId();
  const preset = presetFor(filters.from, filters.to, today);
  const active = !!(filters.mood || filters.tag || filters.from || filters.to);
  const tagOptions = [...new Set([...(filters.tag ? [filters.tag] : []), ...tags])];

  return (
    // One row; on narrow screens it scrolls sideways instead of stacking into a wall of controls.
    <div className="flex items-end gap-2 [scrollbar-width:thin] max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 sm:flex-wrap">
      <Select
        aria-label="Mood"
        value={filters.mood ?? ''}
        onChange={(e) => onChange({ mood: e.target.value || undefined })}
        options={[{ value: '', label: 'Any mood' }, ...MOODS.map((m) => ({ value: m, label: moodLabel(m) }))]}
        containerClassName="shrink-0"
      />
      <Select
        aria-label="Tag"
        value={filters.tag ?? ''}
        onChange={(e) => onChange({ tag: e.target.value || undefined })}
        options={[{ value: '', label: 'Any tag' }, ...tagOptions.map((t) => ({ value: t, label: t }))]}
        disabled={tagOptions.length === 0}
        containerClassName="shrink-0"
      />
      {showDates && (
        <Select
          aria-label="Dates"
          value={preset}
          onChange={(e) => {
            const p = e.target.value as DatePreset;
            if (p === 'custom') onChange({ from: filters.from ?? today.slice(0, 8) + '01', to: filters.to ?? today });
            else onChange(rangeForPreset(p, today) as { from?: string; to?: string });
          }}
          options={[
            { value: 'any', label: 'Any time' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '365', label: 'Last year' },
            { value: 'custom', label: 'Custom dates' },
          ]}
          containerClassName="shrink-0"
        />
      )}
      {showDates && preset === 'custom' && (
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor={fromId} className="sr-only">
            From
          </label>
          <input
            id={fromId}
            type="date"
            value={filters.from ?? ''}
            max={filters.to ?? today}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
            className={dateInput}
          />
          <span className="text-sm text-fg-faint" aria-hidden="true">
            to
          </span>
          <label htmlFor={toId} className="sr-only">
            To
          </label>
          <input
            id={toId}
            type="date"
            value={filters.to ?? ''}
            min={filters.from}
            max={today}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
            className={dateInput}
          />
        </div>
      )}
      {active && (
        <button
          type="button"
          onClick={onClear}
          className="h-11 shrink-0 rounded-control px-3 text-sm whitespace-nowrap text-fg-muted underline underline-offset-2 hover:text-fg sm:h-10"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
