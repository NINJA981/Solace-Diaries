import { useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import type { Citation } from '@solace/shared';
import { SafeMarkdown } from '@/components/ui';
import { formatDay } from '../journal-core/format';
import { citationFromHref, isCitationLink, linkCitations } from '../reflect/citations';

/** AI prose with inline [n] markers that open the cited entry, followed by the entries it drew on. */
export function CitedMarkdown({
  content,
  citations,
  today,
  idBase,
  className,
}: {
  content: string;
  citations: Citation[];
  today: string;
  idBase: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const md = useMemo(() => linkCitations(content, citations), [content, citations]);
  const byN = useMemo(() => new Map(citations.map((c) => [c.n, c])), [citations]);

  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const n = citationFromHref(a.getAttribute('href'));
      if (n === null) return;
      const c = byN.get(n);
      a.setAttribute('aria-label', c ? `Source ${n}: ${c.title || 'Untitled'}, ${formatDay(c.entryDate, today)}` : `Source ${n}`);
      a.removeAttribute('target');
    });
  });

  const open = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const n = citationFromHref(a?.getAttribute('href'));
    if (n === null) return;
    e.preventDefault();
    const c = byN.get(n);
    if (c) navigate(`/app/entries/${c.entryId}`);
  };

  return (
    <div>
      <div ref={ref} onClick={open} onAuxClick={open}>
        <SafeMarkdown allowLink={isCitationLink} className={clsx('font-prose text-reading text-fg', className)}>
          {md}
        </SafeMarkdown>
      </div>
      {citations.length > 0 && (
        <section aria-label="From your journal" className="mt-4">
          <h3 className="mb-2 text-xs font-medium text-ai">From your journal</h3>
          <ol className="grid gap-2 sm:grid-cols-2">
            {citations.map((c) => (
              <li key={c.n} id={`${idBase}-cite-${c.n}`}>
                <Link
                  to={`/app/entries/${c.entryId}`}
                  className="flex h-full gap-2.5 rounded-control border border-line bg-surface px-3 py-2.5 transition-colors hover:border-ai/50"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ai-soft text-caption font-semibold text-ai">{c.n}</span>
                  <span className="min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-prose text-meta text-fg">{c.title.trim() || 'Untitled'}</span>
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
    </div>
  );
}
