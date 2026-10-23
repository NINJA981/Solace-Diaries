import { highlight } from './highlight';

/** Text with query terms wrapped in <mark>. Everything is a React text node (escaped). */
export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-mark bg-accent-soft px-0.5 text-fg underline decoration-accent/60 underline-offset-2">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
