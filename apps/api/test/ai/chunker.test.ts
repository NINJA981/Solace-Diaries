import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_WORDS,
  CHUNK_TARGET_WORDS,
  MAX_TOKEN_CHARS,
  chunkEntry,
} from '../../src/services/chunker';

const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** n numbered sentences of `len` words each: "s1w1 s1w2 … s1w9 end1." */
const sentences = (n: number, len = 10) =>
  Array.from({ length: n }, (_, i) => {
    const w = Array.from({ length: len - 1 }, (_, j) => `s${i}w${j}`);
    return `${w.join(' ')} end${i}.`;
  }).join(' ');

const base = { title: 'A day', entryDate: '2026-03-04' };

describe('chunkEntry', () => {
  it('returns nothing for an empty entry', () => {
    expect(chunkEntry({ ...base, title: '', body: '' })).toEqual([]);
    expect(chunkEntry({ ...base, title: ' ', body: ' \n\n  ' })).toEqual([]);
  });

  it('falls back to the title when there is no body', () => {
    const [c] = chunkEntry({ ...base, title: 'Lunch with Maya at the harbour', body: '' });
    expect(c!.content).toBe('Lunch with Maya at the harbour');
  });

  it('keeps a short entry in one chunk and prefixes context only for embedding', () => {
    const chunks = chunkEntry({ ...base, body: 'First line.\n\nSecond   paragraph here.' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('First line.\n\nSecond paragraph here.');
    expect(chunks[0]!.embedText).toBe(
      'Title: A day\nDate: 2026-03-04\n\nFirst line.\n\nSecond paragraph here.',
    );
  });

  it('labels untitled entries', () => {
    expect(chunkEntry({ ...base, title: '', body: 'hello there' })[0]!.embedText).toMatch(
      /^Title: Untitled\n/,
    );
  });

  it('splits long text near the target size with sentence-aligned overlap', () => {
    const body = sentences(100); // 1000 words
    const chunks = chunkEntry({ ...base, body });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    chunks.forEach((c, i) => expect(c.idx).toBe(i));
    for (const c of chunks) {
      expect(words(c.content).length).toBeLessThanOrEqual(CHUNK_TARGET_WORDS + CHUNK_OVERLAP_WORDS);
    }
    for (let i = 1; i < chunks.length; i++) {
      const prev = words(chunks[i - 1]!.content);
      const cur = words(chunks[i]!.content);
      // Overlap is whole sentences: the chunk starts at a sentence start that the previous chunk contains.
      expect(cur[0]).toMatch(/^s\d+w0$/);
      expect(prev).toContain(cur[0]);
      const overlap = cur.findIndex((w) => !prev.includes(w));
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(CHUNK_OVERLAP_WORDS);
    }
    // Every word of the entry is covered.
    const covered = new Set(chunks.flatMap((c) => words(c.content)));
    for (const w of words(body)) expect(covered.has(w)).toBe(true);
  });

  it('folds a short tail into the previous chunk instead of a mostly-overlap chunk', () => {
    const body = sentences(37); // 370 words: one chunk + a 20-word tail
    const chunks = chunkEntry({ ...base, body });
    expect(chunks).toHaveLength(1);
    expect(words(chunks[0]!.content)).toHaveLength(370);
  });

  it('never emits a tail chunk whose duplicated part exceeds its new part', () => {
    for (let n = 30; n <= 120; n += 7) {
      const chunks = chunkEntry({ ...base, body: sentences(n) });
      for (let i = 1; i < chunks.length; i++) {
        const prev = new Set(words(chunks[i - 1]!.content));
        const cur = words(chunks[i]!.content);
        const dup = cur.filter((w) => prev.has(w)).length;
        expect(dup).toBeLessThanOrEqual(CHUNK_OVERLAP_WORDS);
        expect(cur.length - dup).toBeGreaterThanOrEqual(dup);
      }
    }
  });

  it('splits a single giant sentence and giant tokens', () => {
    const giant = Array.from({ length: 900 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkEntry({ ...base, body: giant });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks)
      expect(words(c.content).length).toBeLessThanOrEqual(CHUNK_TARGET_WORDS + CHUNK_OVERLAP_WORDS);

    const url = `https://example.com/${'x'.repeat(500)}`;
    const [c] = chunkEntry({ ...base, body: `Look at ${url} later.` });
    for (const w of words(c!.content)) expect(w.length).toBeLessThanOrEqual(MAX_TOKEN_CHARS);
    expect(c!.content.replace(/\s+/g, '')).toContain('x'.repeat(40));
  });

  it('appends photo descriptions as their own paragraphs', () => {
    const [c] = chunkEntry({
      ...base,
      body: 'Beach day.',
      attachmentText: 'A dog on sand.\nTwo shells on a towel.',
    });
    expect(c!.content).toBe('Beach day.\n\nPhoto: A dog on sand.\n\nPhoto: Two shells on a towel.');
  });

  it('handles unicode and odd whitespace', () => {
    const [c] = chunkEntry({
      ...base,
      body: '  Café au lait.\t\tÜber gut!  🙂 \r\n\r\n 日本語のテキスト。 ',
    });
    expect(c!.content).toBe('Café au lait. Über gut! 🙂\n\n日本語のテキスト。');
  });
});
