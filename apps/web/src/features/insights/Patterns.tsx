import { VisuallyHidden } from '@/components/ui';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { plural } from '../journal-core/format';
import { useCorrelations } from '../journal-core/queries-v3b';
import { topPatterns } from './patternWording';

/** A tiny dumbbell: where this tag's days sit against your usual, on the -2…+2 mood scale. */
function Range({ avg, baseline, up }: { avg: number; baseline: number; up: boolean }) {
  const x = (v: number) => 6 + ((Math.max(-2, Math.min(2, v)) + 2) / 4) * 108;
  return (
    <svg viewBox="0 0 120 16" width={120} height={16} aria-hidden="true" className="shrink-0">
      <line x1={6} x2={114} y1={8} y2={8} stroke="var(--line-strong)" strokeWidth={2} strokeLinecap="round" />
      <line x1={x(baseline)} x2={x(avg)} y1={8} y2={8} stroke={up ? 'var(--mood-4)' : 'var(--mood-2)'} strokeWidth={3} strokeLinecap="round" />
      <line x1={x(baseline)} x2={x(baseline)} y1={3} y2={13} stroke="var(--fg-muted)" strokeWidth={2} />
      <circle cx={x(avg)} cy={8} r={5} fill={up ? 'var(--mood-4)' : 'var(--mood-2)'} stroke="var(--canvas)" strokeWidth={1.5} />
    </svg>
  );
}

/** Mood patterns: tags that tend to sit with calmer or heavier days. Never causal. */
export function Patterns() {
  const tz = useTimezone();
  const voice = useVoice();
  const q = useCorrelations(tz);
  if (q.isPending) return <div aria-hidden="true" className="h-24 animate-pulse rounded-card bg-sunken" />;
  if (q.isError) return <InlineError message="Couldn’t load your patterns." onRetry={() => void q.refetch()} />;
  const rows = topPatterns(q.data.items);
  if (rows.length === 0)
    return (
      <p className="max-w-prose text-sm text-fg-muted">
        {voice.patternsEmpty} <VisuallyHidden>Needs about {q.data.minEntries} entries with moods.</VisuallyHidden>
      </p>
    );
  const byTag = new Map(q.data.items.map((c) => [c.tag, c]));
  return (
    <ul className="max-w-3xl rounded-card border border-line bg-surface px-4 sm:px-5">
      {rows.map((p) => {
        const c = byTag.get(p.tag)!;
        return (
          <li key={p.tag} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0">
            <span className="inline-flex h-7 max-w-[10rem] items-center truncate rounded-full border border-line bg-sunken px-3 text-xs font-medium text-fg">{p.tag}</span>
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm text-fg">{p.text}</p>
              <p className="text-xs text-fg-muted">
                {p.figure} · from {plural(p.entries, 'entry', 'entries')}
              </p>
            </div>
            <Range avg={c.avgMood} baseline={c.baseline} up={p.direction === 'up'} />
          </li>
        );
      })}
    </ul>
  );
}
