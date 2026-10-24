import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Minus, Plus, RefreshCw } from 'lucide-react';
import { localDate, type Chapter, type EntrySummary } from '@solace/shared';
import { Button, EmptyState, Skeleton, VisuallyHidden, buttonClasses, toast } from '@/components/ui';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { formatShortDay, plural } from '../journal-core/format';
import { useTeenFlags } from '../teen/flags';
import { qk } from '../journal-core/queries';
import { useChapters, useRefreshChapters } from '../journal-core/queries-v3b';
import { LANE_GAP, LANE_H, ZOOMS, clampZoom, layoutChapters, roleVar } from './layout';

/** Entry titles already in the query cache (from Journal or Today), so key-entry links can say more than a number. */
function useCachedTitles(): Map<string, string> {
  const qc = useQueryClient();
  const out = new Map<string, string>();
  for (const [, data] of qc.getQueriesData<{ pages?: { items: EntrySummary[] }[] }>({ queryKey: qk.entriesAll })) {
    for (const page of data?.pages ?? []) for (const e of page.items) if (e.title?.trim()) out.set(e.id, e.title.trim());
  }
  return out;
}

function range(c: Chapter): string {
  return c.to ? `${formatShortDay(c.from)} to ${formatShortDay(c.to)}` : `${formatShortDay(c.from)} to now`;
}

function ChapterBody({ c, compact = false }: { c: Chapter; compact?: boolean }) {
  const titles = useCachedTitles();
  const { peopleMap } = useTeenFlags();
  return (
    <>
      <h3 className="type-heading text-lg leading-snug text-fg">{c.title}</h3>
      <p className="mt-0.5 text-xs text-fg-muted">{range(c)}</p>
      <p className={`mt-2 font-prose text-note text-fg-muted ${compact ? 'line-clamp-3' : ''}`}>{c.summary}</p>
      {peopleMap && c.cast.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Who appears">
          {c.cast.map((n) => (
            <li key={n} className="rounded-full border border-line bg-sunken px-2.5 py-0.5 text-xs text-fg">
              {n}
            </li>
          ))}
        </ul>
      )}
      {c.keyEntryIds.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-fg-faint">Key entries</span>
          {c.keyEntryIds.slice(0, 4).map((id, i) => (
            <Link key={id} to={`/app/entries/${id}`} className="inline-flex min-h-8 max-w-[16ch] items-center truncate font-medium text-accent underline underline-offset-2 max-sm:min-h-11">
              {titles.get(id) ?? `Entry ${i + 1}`}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}

export default function ChaptersPage() {
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const voice = useVoice();
  const [polling, setPolling] = useState(false);
  const list = useChapters({ poll: polling });
  const refresh = useRefreshChapters();
  const [zoom, setZoom] = useState(2);
  const scroller = useRef<HTMLDivElement>(null);
  const before = useRef<string | null>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const layout = useMemo(() => layoutChapters(items, today, ZOOMS[clampZoom(zoom)]!), [items, today, zoom]);

  // After a refresh, poll the list until the generation time moves (or a minute passes).
  useEffect(() => {
    if (!polling) return;
    if (list.data && before.current !== null && (list.data.generatedAt ?? '') !== before.current) {
      setPolling(false);
      toast('Chapters updated');
      return;
    }
    const t = window.setTimeout(() => setPolling(false), 60_000);
    return () => window.clearTimeout(t);
  }, [polling, list.data]);

  const startRefresh = () => {
    before.current = list.data?.generatedAt ?? '';
    refresh.mutate(undefined, {
      onSuccess: () => setPolling(true),
      onError: (e) => toast(e instanceof ApiRequestError && e.status === 429 ? 'Chapters were refreshed a moment ago. Try again shortly.' : errorMessage(e), { tone: 'danger' }),
    });
  };

  // Start the timeline at the latest chapter.
  useEffect(() => {
    const el = scroller.current;
    if (el && layout.width) el.scrollLeft = el.scrollWidth;
  }, [layout.width === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = refresh.isPending || polling;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 sm:px-8 sm:pt-10">
      <Link to="/app/insights" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted hover:text-fg sm:min-h-8">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Insights
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-heading text-3xl text-fg sm:text-4xl">Life chapters</h1>
          <p className="mt-2 max-w-prose text-fg-muted">The seasons Solace sees in your writing, drawn from your entries. They’re a reading, not a verdict: you can always see which entries each came from.</p>
        </div>
        <Button variant="secondary" loading={busy} onClick={startRefresh} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
          {busy ? 'Refreshing' : 'Refresh chapters'}
        </Button>
      </div>

      {list.data?.stale && !busy && (
        <p className="mt-4 max-w-prose rounded-control border border-ai/30 bg-ai-soft px-4 py-2.5 text-sm text-fg">
          You’ve written enough since the last reading that a refresh would change things.
        </p>
      )}
      {busy && (
        <p role="status" className="mt-4 text-sm text-ai">
          Solace is reading your chapters. This can take a minute.
        </p>
      )}

      <div className="mt-8">
        {list.isPending ? (
          <Skeleton className="h-48 rounded-card" />
        ) : list.isError ? (
          <InlineError message="Couldn’t load your chapters." onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <div className="rounded-card border border-line bg-sunken">
            <EmptyState
              icon={<BookOpen />}
              title="Chapters need a little more writing"
              description={`${voice.chaptersEmpty} Solace looks for at least ${plural(list.data.minEntries, 'entry', 'entries')}.`}
              action={
                <Link to="/app/today" className={buttonClasses('primary')}>
                  Write today’s entry
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-fg-faint">Scroll sideways, or zoom the time scale.</p>
              <div className="flex items-center gap-1" role="group" aria-label="Zoom timeline">
                <Button variant="ghost" size="sm" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => clampZoom(z - 1))} icon={<Minus className="size-4" aria-hidden="true" />} />
                <Button variant="ghost" size="sm" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => clampZoom(z + 1))} icon={<Plus className="size-4" aria-hidden="true" />} />
              </div>
            </div>
            <div
              ref={scroller}
              tabIndex={0}
              role="region"
              aria-label="Chapters timeline, scrolls sideways"
              className="overflow-x-auto rounded-card border border-line bg-surface pb-3"
            >
              <div className="relative" style={{ width: layout.width, height: 36 + layout.lanes * (LANE_H + LANE_GAP) }}>
                <div aria-hidden="true" className="absolute inset-x-0 top-0 h-8 border-b border-line">
                  {layout.ticks.map((t, i) => (
                    <span key={i} className={`absolute top-1.5 border-l pl-1.5 text-xs ${t.major ? 'border-line-strong font-medium text-fg-muted' : 'border-line text-fg-faint'}`} style={{ left: t.left + 8 }}>
                      {t.label}
                    </span>
                  ))}
                </div>
                <ol>
                  {layout.items.map(({ chapter, left, width, lane, ongoing }) => (
                    <li
                      key={chapter.id}
                      className="absolute overflow-hidden rounded-card border border-line bg-raised px-4 py-3 shadow-1"
                      style={{
                        left: left + 8,
                        width: width - 8,
                        top: 40 + lane * (LANE_H + LANE_GAP),
                        height: LANE_H,
                        borderTop: `4px solid ${roleVar(chapter.color)}`,
                      }}
                    >
                      <ChapterBody c={chapter} compact />
                      {ongoing && <VisuallyHidden>This is the chapter you’re in now.</VisuallyHidden>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <details className="mt-6">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-fg-muted hover:text-fg sm:min-h-8">Read as a list</summary>
              <ol className="mt-4 space-y-5">
                {items
                  .slice()
                  .sort((a, b) => b.from.localeCompare(a.from))
                  .map((c) => (
                    <li key={c.id} className="max-w-prose border-l-4 pl-4" style={{ borderColor: roleVar(c.color) }}>
                      <ChapterBody c={c} />
                    </li>
                  ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
