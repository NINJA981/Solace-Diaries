import { RotateCcw, Mail } from 'lucide-react';
import { weekStart, type DayStat } from '@solace/shared';
import { Button, SafeMarkdown } from '@/components/ui';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { InlineError } from '../journal-core/EntryCard';
import { formatShortDay, plural } from '../journal-core/format';
import { useRefreshWeekly, useWeekly } from '../journal-core/queries';

function refreshErrorCopy(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'ai_quota_exceeded') return 'You’ve used today’s AI allowance. The letter can be written again tomorrow.';
    if (err.status === 429) return 'That was quick. Wait a minute, then try again.';
    if (err.code === 'ai_unavailable' || err.status === 503)
      return 'Solace can’t reach its AI service right now, so the letter can’t be written. Try again in a few minutes.';
  }
  return errorMessage(err);
}

function Shimmer() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {['w-11/12', 'w-full', 'w-4/5', 'w-2/3'].map((w) => (
        <div key={w} className={`h-4 animate-pulse rounded bg-dusk-soft ${w}`} />
      ))}
    </div>
  );
}

/** Solace's letter about the week, cached server-side and refreshable when new entries arrive. */
export function WeeklyLetter({ tz, today, days }: { tz: string; today: string; days: DayStat[] }) {
  const weekly = useWeekly(tz);
  const refresh = useRefreshWeekly(tz);
  const thisWeek = weekStart(today);
  const entriesThisWeek = days.filter((d) => d.date >= thisWeek).reduce((n, d) => n + d.count, 0);
  const letter = weekly.data?.letter ?? null;
  const minEntries = weekly.data?.minEntries ?? 3;
  const canWrite = entriesThisWeek >= minEntries;

  return (
    <article
      aria-labelledby="weekly-title"
      aria-busy={weekly.isPending || refresh.isPending}
      className="rounded-card border border-dusk/25 bg-dusk-soft px-5 py-5 sm:px-7 sm:py-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 id="weekly-title" className="font-serif text-xl text-fg">
            This week’s letter
          </h2>
          <p className="mt-0.5 text-xs text-dusk">
            {letter ? `From Solace, week of ${formatShortDay(letter.weekStart)}` : `From Solace, week of ${formatShortDay(thisWeek)}`}
          </p>
        </div>
        {letter && letter.stale && (
          <Button
            variant="secondary"
            size="sm"
            loading={refresh.isPending}
            icon={<RotateCcw className="size-3.5" aria-hidden="true" />}
            onClick={() => refresh.mutate()}
            className="max-sm:h-11"
          >
            Refresh letter
          </Button>
        )}
      </div>

      {weekly.isPending || refresh.isPending ? (
        <>
          <Shimmer />
          {refresh.isPending && <p className="mt-4 text-xs text-dusk" role="status">Solace is reading your week…</p>}
        </>
      ) : weekly.isError ? (
        <InlineError message={refreshErrorCopy(weekly.error)} onRetry={() => void weekly.refetch()} />
      ) : letter ? (
        <>
          <SafeMarkdown className="max-w-[64ch] font-serif text-[1.06rem] leading-[1.7] text-fg">{letter.content}</SafeMarkdown>
          <p className="mt-4 text-xs text-fg-faint">
            Written from {plural(letter.entryCount, 'entry', 'entries')}.
            {letter.stale ? ' You’ve written more since, so a refresh will include it.' : ''}
          </p>
        </>
      ) : canWrite ? (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose text-sm text-fg-muted">
            You’ve written {plural(entriesThisWeek, 'entry', 'entries')} this week. Solace can read them together and write you a short letter about the week.
          </p>
          <Button variant="primary" size="sm" icon={<Mail className="size-4" aria-hidden="true" />} onClick={() => refresh.mutate()} className="max-sm:h-11">
            Write this week’s letter
          </Button>
        </div>
      ) : (
        <p className="max-w-prose text-sm text-fg-muted">
          Solace writes a letter once there are {minEntries} entries in a week.{' '}
          {entriesThisWeek > 0
            ? `You have ${entriesThisWeek} so far, so ${plural(minEntries - entriesThisWeek, 'more entry', 'more entries')} will do it.`
            : 'Nothing yet this week.'}
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {refreshErrorCopy(refresh.error)}
        </p>
      )}
    </article>
  );
}
