import { Link } from 'react-router';
import { useVoice } from '@/lib/voice';
import { formatDay } from '../journal-core/format';
import { useResurface } from '../journal-core/queries-v3';
import { toCards } from './mapping';

/**
 * A slim strip of up to three older entries above the editor. Hidden while loading, on error
 * and when there is nothing to show: it never takes space it has not earned.
 */
export function RememberWhen({ tz, today }: { tz: string; today: string }) {
  const voice = useVoice();
  const q = useResurface(tz, today);
  const cards = toCards(q.data);
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="remember-when" data-testid="remember-when" className="mb-6">
      <h2 id="remember-when" className="mb-2 text-sm font-medium text-fg-muted">
        {voice.rememberWhenTitle}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id}>
            <Link
              to={`/app/entries/${c.id}`}
              className="flex h-full min-h-11 flex-col rounded-card border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong"
            >
              <span className="text-xs text-fg-faint">
                <time dateTime={c.date}>{formatDay(c.date, today)}</time>
                {c.reason && <span> · {c.reason}</span>}
              </span>
              <span className="mt-1 line-clamp-1 type-heading text-base text-fg">{c.title}</span>
              {c.excerpt && <span className="mt-0.5 hidden line-clamp-2 font-prose text-sm sm:block leading-snug text-fg-muted">{c.excerpt}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
