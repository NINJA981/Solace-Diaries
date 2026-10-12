/**
 * Paragraph- and sentence-aware chunking for embeddings. Chunks aim for ~350 words with a
 * ~60-word sentence-aligned overlap; a short tail is folded into the previous chunk so no
 * chunk is mostly duplicated text. The stored `content` is the raw passage (used for
 * snippets and citations); `embedText` adds title/date context for the embedding only.
 */

export const CHUNK_TARGET_WORDS = 350;
export const CHUNK_OVERLAP_WORDS = 60;
/** Longer "words" (URLs, pasted hashes) are split so a single token can't blow a chunk up. */
export const MAX_TOKEN_CHARS = 48;

export type ChunkInput = {
  title: string;
  entryDate: string;
  body: string;
  attachmentText?: string;
};
export type Chunk = { idx: number; content: string; embedText: string };

/** A run of words that should stay together (a sentence or a slice of an over-long one). */
type Unit = { para: number; words: string[] };

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function splitToken(token: string): string[] {
  if (token.length <= MAX_TOKEN_CHARS) return [token];
  const parts: string[] = [];
  for (let i = 0; i < token.length; i += MAX_TOKEN_CHARS)
    parts.push(token.slice(i, i + MAX_TOKEN_CHARS));
  return parts;
}

function toUnits(paragraphs: string[]): Unit[] {
  const units: Unit[] = [];
  paragraphs.forEach((para, p) => {
    for (const { segment } of segmenter.segment(para)) {
      const words = segment.split(/\s+/u).filter(Boolean).flatMap(splitToken);
      for (let i = 0; i < words.length; i += CHUNK_TARGET_WORDS) {
        units.push({ para: p, words: words.slice(i, i + CHUNK_TARGET_WORDS) });
      }
    }
  });
  return units;
}

const size = (units: Unit[]) => units.reduce((n, u) => n + u.words.length, 0);

/** Trailing whole sentences totalling ≤ the overlap; falls back to the last words of a long sentence. */
function overlapOf(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  let n = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]!;
    if (n + u.words.length > CHUNK_OVERLAP_WORDS) break;
    out.unshift(u);
    n += u.words.length;
  }
  if (out.length === 0 && units.length > 0) {
    const last = units[units.length - 1]!;
    out.push({ para: last.para, words: last.words.slice(-CHUNK_OVERLAP_WORDS) });
  }
  return out;
}

function render(units: Unit[]): string {
  const paras: string[][] = [];
  let prev: number | undefined;
  for (const u of units) {
    if (u.para !== prev) paras.push([]);
    paras[paras.length - 1]!.push(u.words.join(' '));
    prev = u.para;
  }
  return paras.map((p) => p.join(' ')).join('\n\n');
}

export function chunkEntry(input: ChunkInput): Chunk[] {
  const paragraphs = input.body
    .split(/\n\s*\n/u)
    .map((p) => p.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  for (const line of (input.attachmentText ?? '').split('\n')) {
    if (line.trim()) paragraphs.push(`Photo: ${line.trim()}`);
  }
  if (paragraphs.length === 0 && input.title.trim()) paragraphs.push(input.title.trim());

  const units = toUnits(paragraphs);
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let overlapUnits = 0; // leading units of `current` copied from the previous chunk

  for (const unit of units) {
    if (current.length > overlapUnits && size(current) + unit.words.length > CHUNK_TARGET_WORDS) {
      groups.push(current);
      current = overlapOf(current);
      overlapUnits = current.length;
    }
    current.push(unit);
  }
  const fresh = current.slice(overlapUnits);
  const last = groups[groups.length - 1];
  if (last && size(fresh) < CHUNK_OVERLAP_WORDS) {
    // Fold a short tail into the previous chunk instead of emitting a mostly-overlap chunk.
    last.push(...fresh);
  } else if (fresh.length > 0) {
    groups.push(current);
  }

  const header = `Title: ${input.title.trim() || 'Untitled'}\nDate: ${input.entryDate}\n\n`;
  return groups.map((g, idx) => {
    const content = render(g);
    return { idx, content, embedText: header + content };
  });
}
