import { Link } from 'react-router';
import { useSession, useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { currentWeek, isDone, isSunday } from './ritualLogic';

/** A quiet Sunday card (Sunday in the person's timezone). Gone once this week's review is saved. */
export function WeeklyReviewCard({ now = new Date() }: { now?: Date }) {
  const tz = useTimezone();
  const { userId } = useSession();
  const voice = useVoice();
  if (!isSunday(now, tz)) return null;
  if (userId && isDone(userId, currentWeek(now, tz))) return null;
  return (
    <aside
      aria-labelledby="weekly-review-card"
      data-testid="weekly-review-card"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-line bg-surface px-4 py-3"
    >
      <div className="min-w-0">
        <h2 id="weekly-review-card" className="type-heading text-base text-fg">
          {voice.weeklyReviewTitle}
        </h2>
        <p className="hidden text-sm text-fg-muted sm:block">{voice.weeklyReviewBody}</p>
      </div>
      <Link
        to="/app/ritual"
        className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-accent underline underline-offset-2 sm:min-h-8"
      >
        Start review
      </Link>
    </aside>
  );
}
