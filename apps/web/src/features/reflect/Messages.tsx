import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { RotateCcw } from 'lucide-react';
import type { Citation } from '@solace/shared';
import { SafeMarkdown } from '@/components/ui';
import { formatDay } from '../journal-core/format';
import { citationFromHref, citedNumbers, linkCitations, stableStreamText } from './citations';
import '../journal-core/journal.css';

export function UserBubble({ content, pending }: { content: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={clsx(
          'max-w-[85%] rounded-card rounded-br-[4px] border border-lamp/25 bg-lamp-soft px-4 py-2.5 text-[0.98rem] leading-relaxed whitespace-pre-wrap text-fg sm:max-w-[75%]',
          pending && 'opacity-80',
        )}
      >
        <span className="sr-only">You: </span>
        {content}
      </div>
    </div>
  );
}

type AnswerProps = {
  content: string;
  citations: Citation[];
  streaming?: boolean;
  /** Muted treatment for a stopped, unsaved partial answer. */
  partial?: boolean;
  today: string;
  idBase: string;
  footer?: React.ReactNode;
};

/** Solace's answer: dusk-accented prose, inline [n] markers, and the entries it drew on. */
export const Answer = memo(function Answer({ content, citations, streaming, partial, today, idBase, footer }: AnswerProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const shown = streaming ? stableStreamText(content) : content;
  const md = useMemo(() => linkCitations(shown, citations), [shown, citations]);
  const cited = useMemo(() => {
    const nums = citedNumbers(content, citations);
    const byN = new Map(citations.map((c) => [c.n, c]));
    // Sources the answer actually points to first, then the rest it was given.
    const ordered = [...nums.map((n) => byN.get(n)!), ...citations.filter((c) => !nums.includes(c.n))];
    return streaming ? ordered.filter((c) => nums.includes(c.n)) : ordered;
  }, [content, citations, streaming]);
  const byN = useMemo(() => new Map(citations.map((c) => [c.n, c])), [citations]);

  // Give each marker link a real name and keep it in-app.
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const n = citationFromHref(a.getAttribute('href'));
      if (n === null) return;
      const c = byN.get(n);
      a.setAttribute('aria-label', c ? `Source ${n}: ${c.title || 'Untitled'}, ${formatDay(c.entryDate, today)}` : `Source ${n}`);
      a.removeAttribute('target');
    });
  });

  const openCitation = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const n = citationFromHref(a?.getAttribute('href'));
    if (n === null) return;
    e.preventDefault();
    const c = byN.get(n);
    if (c) navigate(`/app/entries/${c.entryId}`);
  };

  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-dusk shadow-[0_0_10px_var(--dusk)]" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">Solace: </span>
        <div ref={ref} onClick={openCitation} onAuxClick={openCitation} className={clsx(partial && 'opacity-75')}>
          {md ? (
            <SafeMarkdown
              className={clsx('solace-answer font-serif text-[1.06rem] leading-[1.7] text-fg', streaming && 'solace-streaming')}
            >
              {md}
            </SafeMarkdown>
          ) : streaming ? (
            <p className="flex items-center gap-2 text-sm text-dusk">
              <span aria-hidden="true" className="solace-caret" />
              Looking through your journal…
            </p>
          ) : null}
        </div>
        {cited.length > 0 && (
          <section aria-label="From your journal" className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-dusk">From your journal</h3>
            <ol className="grid gap-2 sm:grid-cols-2">
              {cited.map((c) => (
                <li key={c.n} id={`${idBase}-cite-${c.n}`}>
                  <Link
                    to={`/app/entries/${c.entryId}`}
                    viewTransition
                    className="flex h-full gap-2.5 rounded-control border border-line bg-surface px-3 py-2.5 transition-colors hover:border-dusk/50"
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-dusk-soft text-[0.7rem] font-semibold text-dusk">
                      {c.n}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-serif text-[0.95rem] text-fg">{c.title.trim() || 'Untitled'}</span>
                        <time dateTime={c.entryDate} className="shrink-0 text-xs text-fg-faint">
                          {formatDay(c.entryDate, today)}
                        </time>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-muted">{c.snippet}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
        {footer}
      </div>
    </div>
  );
});

export function RegenerateButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-control px-2 text-xs text-fg-faint transition-colors hover:text-fg disabled:opacity-50 sm:h-8 -ml-2"
    >
      <RotateCcw className="size-3.5" aria-hidden="true" />
      Regenerate answer
    </button>
  );
}
