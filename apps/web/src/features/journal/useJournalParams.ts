import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { MOODS, addDays, type Mood } from '@solace/shared';
import type { EntryFilters, SearchMode } from '../journal-core/queries';

export type JournalView = 'timeline' | 'calendar';
export type DatePreset = 'any' | '7' | '30' | '365' | 'custom';

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** All Journal state lives in the URL so it survives reloads and is shareable to yourself. */
export function useJournalParams() {
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const mode: SearchMode = params.get('mode') === 'keyword' ? 'keyword' : 'hybrid';
  const view: JournalView = params.get('view') === 'calendar' ? 'calendar' : 'timeline';
  const moodParam = params.get('mood');
  const mood = MOODS.includes(moodParam as Mood) ? (moodParam as Mood) : undefined;
  const tag = params.get('tag') || undefined;
  const from = isDate(params.get('from')) ? params.get('from')! : undefined;
  const to = isDate(params.get('to')) ? params.get('to')! : undefined;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : undefined;
  const day = isDate(params.get('day')) ? params.get('day')! : undefined;

  const filters: EntryFilters = useMemo(() => ({ mood, tag, from, to }), [mood, tag, from, to]);
  const hasFilters = !!(mood || tag || from || to);

  const update = useCallback(
    (patch: Record<string, string | undefined | null>, opts: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: opts.replace ?? true },
      );
    },
    [setParams],
  );

  return { q, mode, view, filters, hasFilters, month, day, update };
}

/** Which preset (if any) a from/to pair corresponds to, relative to today. */
export function presetFor(from: string | undefined, to: string | undefined, today: string): DatePreset {
  if (!from && !to) return 'any';
  if (to && to !== today) return 'custom';
  if (from === addDays(today, -6)) return '7';
  if (from === addDays(today, -29)) return '30';
  if (from === addDays(today, -364)) return '365';
  return 'custom';
}

export function rangeForPreset(p: DatePreset, today: string): { from?: string; to?: string } {
  switch (p) {
    case '7':
      return { from: addDays(today, -6), to: today };
    case '30':
      return { from: addDays(today, -29), to: today };
    case '365':
      return { from: addDays(today, -364), to: today };
    default:
      return {};
  }
}
