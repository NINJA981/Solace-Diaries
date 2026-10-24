import { localDate } from '@solace/shared';
import { Sprout } from 'lucide-react';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { formatShortDay } from '../journal-core/format';
import { useLatestGrowthNote } from '../journal-core/queries-v3b';
import { CitedMarkdown } from '../letters/CitedMarkdown';

/** The latest growth note: a gentle observation of change, always with the entries it comes from. */
export function GrowthNote() {
  const note = useLatestGrowthNote();
  const voice = useVoice();
  const today = localDate(new Date(), useTimezone());

  if (note.isPending) return <div aria-hidden="true" className="h-24 animate-pulse rounded-card bg-sunken" />;
  if (note.isError) return <InlineError message="Couldn’t load your growth note." onRetry={() => void note.refetch()} />;
  if (!note.data) return <p className="max-w-prose text-sm text-fg-muted">{voice.growthEmpty}</p>;
  const n = note.data;
  return (
    <article aria-label="Growth note" className="rounded-card border border-ai/25 bg-ai-soft px-5 py-5 sm:px-7 sm:py-6">
      <p className="mb-3 flex items-center gap-2 text-xs text-ai">
        <Sprout className="size-3.5" aria-hidden="true" />
        From Solace, week of {formatShortDay(n.weekStart)}
      </p>
      <CitedMarkdown content={n.text} citations={n.citations} today={today} idBase={`growth-${n.id}`} className="max-w-[64ch]" />
    </article>
  );
}
