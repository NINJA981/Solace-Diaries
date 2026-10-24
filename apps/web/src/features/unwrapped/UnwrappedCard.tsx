import { Link } from 'react-router';
import { ArrowRight, Gift } from 'lucide-react';
import { localDate } from '@solace/shared';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { defaultMonth } from './story';

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(`${m}-01T12:00:00Z`));

/** A calm entry point at the top of Insights. */
export function UnwrappedCard() {
  const voice = useVoice();
  const month = defaultMonth(localDate(new Date(), useTimezone()));
  return (
    <Link
      to={`/app/insights/unwrapped?period=month&at=${month}`}
      className="group flex items-center gap-4 rounded-card border border-ai/30 bg-ai-soft px-5 py-4 transition-colors hover:border-ai/60 sm:px-6"
    >
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ai">
        <Gift className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-heading block text-lg text-fg">
          {voice.unwrappedCardTitle.replace(/month/i, monthName(month))}
        </span>
        <span className="mt-0.5 block text-sm text-fg-muted">{voice.unwrappedCardBody}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
