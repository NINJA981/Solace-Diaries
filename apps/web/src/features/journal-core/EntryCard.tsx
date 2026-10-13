import type { ReactNode } from 'react';
import { Link, useViewTransitionState } from 'react-router';
import { clsx } from 'clsx';
import { Image as ImageIcon } from 'lucide-react';
import type { EntrySummary } from '@solace/shared';
import { MoodDot } from '@/components/ui';
import { moodLabel, relativeDay } from './format';
import { isEnriching } from './queries';
import './journal.css';

type Props = {
  entry: EntrySummary;
  today: string;
  /** Replaces the excerpt (e.g. a highlighted search snippet). */
  snippet?: ReactNode;
  /** Extra line under the meta row (e.g. "matched by meaning"). */
  footnote?: ReactNode;
  headingLevel?: 'h2' | 'h3';
  className?: string;
};

/** A journal entry in a list: the whole card is one link, details are read out in order. */
export function EntryCard({ entry, today, snippet, footnote, headingLevel = 'h3', className }: Props) {
  const H = headingLevel;
  const title = entry.title.trim() || 'Untitled';
  const href = `/app/entries/${entry.id}`;
  // Only the card being opened carries the shared name, so it morphs into the editor title.
  const morphing = useViewTransitionState(href);
  return (
    <article
      className={clsx(
        '@container group relative rounded-card border border-line bg-surface px-4 py-4 transition-colors hover:border-line-strong sm:px-5',
        className,
      )}
    >
      <div className="flex flex-col-reverse gap-0.5 @sm:flex-row @sm:items-baseline @sm:justify-between @sm:gap-3">
        <H
          className={clsx('min-w-0 truncate font-serif text-lg leading-snug', entry.title.trim() ? 'text-fg' : 'text-fg-muted italic')}
          style={morphing ? { viewTransitionName: 'entry-title', width: 'fit-content' } : undefined}
        >
          <Link
            to={href}
            viewTransition
            className="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {title}
          </Link>
        </H>
        <time dateTime={entry.entryDate} className="shrink-0 text-xs text-fg-faint">
          {relativeDay(entry.entryDate, today)}
        </time>
      </div>
      {(snippet ?? entry.excerpt) && (
        <p className="mt-1.5 line-clamp-2 font-serif text-[0.98rem] leading-relaxed text-fg-muted">
          {snippet ?? entry.excerpt}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-faint">
        {entry.mood && (
          <span className={clsx('inline-flex items-center gap-1.5', entry.moodSource === 'ai' && 'text-dusk')}>
            <span aria-hidden="true" className="inline-flex">
              <MoodDot mood={entry.mood} size={8} />
            </span>
            {moodLabel(entry.mood)}
            {entry.moodSource === 'ai' && <span className="sr-only">(sensed by Solace)</span>}
          </span>
        )}
        {entry.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded-full bg-sunken px-2 py-0.5 text-fg-muted">
            {t}
          </span>
        ))}
        {entry.tags.length > 3 && <span>+{entry.tags.length - 3} more</span>}
        {entry.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="size-3.5" aria-hidden="true" />
            {entry.attachmentCount}
            <span className="sr-only">{entry.attachmentCount === 1 ? 'photo' : 'photos'}</span>
          </span>
        )}
        {isEnriching(entry.enrichmentStatus) && <span className="text-dusk">Solace is reading…</span>}
        {footnote}
      </div>
    </article>
  );
}

export function EntryCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-surface px-5 py-4">
      <div className="flex justify-between gap-4">
        <div className="h-5 w-1/2 animate-pulse rounded bg-sunken" />
        <div className="h-4 w-14 animate-pulse rounded bg-sunken" />
      </div>
      <div className="mt-3 h-4 w-full animate-pulse rounded bg-sunken" />
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-sunken" />
    </div>
  );
}

/** Inline error with a retry button, for any failed query. */
export function InlineError({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-fg', className)}>
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex h-11 items-center rounded-control px-3 font-medium text-fg underline underline-offset-2 hover:bg-raised sm:h-8">
          Try again
        </button>
      )}
    </div>
  );
}
