import { ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';

const SOURCES = [
  { n: 1, date: '18 March', title: 'Morning walks', snippet: 'Third day walking before work. Slept straight through again.' },
  { n: 2, date: '29 March', title: 'The lake with Maya', snippet: 'Didn’t check the time once all afternoon.' },
  { n: 3, date: '13 June', title: 'Long weekend', snippet: 'Took Friday off. First Monday in ages I didn’t dread.' },
];

function Cite({ n }: { n: number }) {
  return (
    <sup className="mx-0.5 inline-grid h-[1.15rem] min-w-[1.15rem] -translate-y-[0.1em] place-items-center rounded-full bg-ai-soft px-1 align-baseline font-ui text-caption leading-none font-semibold text-ai ring-1 ring-ai/30">
      <span className="sr-only">source </span>
      {n}
    </sup>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-ui text-xs text-fg-faint">{children}</p>;
}

/** A static, HTML-built preview of a Reflect conversation (no screenshots). */
export function ReflectGlimpse() {
  return (
    <figure className="relative">
      <div className="overflow-hidden rounded-sheet border border-line bg-canvas shadow-1">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-sm font-medium text-fg">Feeling rested</p>
          <p className="text-xs text-fg-faint">Reflect</p>
        </div>

        <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
          <div className="ml-auto max-w-[85%] rounded-card rounded-br-mark bg-accent-soft px-4 py-2.5 text-sm leading-body text-fg ring-1 ring-accent/35">
            When have I felt most rested this year?
          </div>

          <div className="border-l-2 border-ai/60 pl-4">
            <Label>
              <span className="text-ai">Solace</span>, from 3 entries
            </Label>
            <p className="mt-2 font-prose text-base leading-markdown text-fg sm:text-lg">
              Late March stands out. You wrote about sleeping straight through once you started walking before work
              <Cite n={1} />, and a quiet afternoon at the lake with Maya when you “didn’t check the time once”
              <Cite n={2} />. In June, taking a Friday off left you rested enough that Monday didn’t feel heavy
              <Cite n={3} />.
            </p>
          </div>

          <ol aria-label="Sources" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {SOURCES.map((s) => (
              <li key={s.n} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 grid size-[1.15rem] shrink-0 place-items-center rounded-full bg-ai-soft text-caption font-semibold text-ai">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    <span className="font-medium">{s.title}</span>
                    <span className="text-fg-faint">, {s.date}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 font-prose text-meta text-fg-muted italic">{s.snippet}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div aria-hidden="true" className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="flex-1 text-sm text-fg-faint">Ask about your journal…</span>
          <span className="grid size-8 place-items-center rounded-control bg-accent text-accent-fg">
            <ArrowUp className="size-4" />
          </span>
        </div>
      </div>
      <figcaption className="sr-only">
        An example Reflect conversation: a question about feeling rested, answered from three journal entries with a
        link to each.
      </figcaption>
    </figure>
  );
}
