/**
 * Split text into plain/highlighted segments for query terms. The result is rendered as
 * React text nodes (escaped by React) — never as HTML.
 */
export type Segment = { text: string; match: boolean };

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'i', 'my', 'me', 'is', 'it', 'at', 'or', 'for']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Query terms worth highlighting: quoted phrases kept whole, short/stop words dropped. */
export function queryTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    const t = m[1] ? raw : raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!t) continue;
    if (!m[1] && (t.length < 2 || STOP.has(t.toLowerCase()))) continue;
    terms.push(t);
  }
  // Longest first so "running" wins over "run" in the alternation.
  return [...new Set(terms)].sort((a, b) => b.length - a.length);
}

export function highlight(text: string, query: string): Segment[] {
  const terms = queryTerms(query);
  if (!text) return [];
  if (terms.length === 0) return [{ text, match: false }];
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu');
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (m[0].length === 0) continue;
    if (i > last) out.push({ text: text.slice(last, i), match: false });
    out.push({ text: m[0], match: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}
