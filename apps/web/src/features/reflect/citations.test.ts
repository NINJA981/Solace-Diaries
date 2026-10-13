import { describe, expect, it } from 'vitest';
import type { Citation } from '@solace/shared';
import { CITE_PREFIX, citationFromHref, citedNumbers, linkCitations, stableStreamText } from './citations';

const cite = (n: number): Citation => ({
  n,
  entryId: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Entry ${n}`,
  entryDate: '2026-10-01',
  snippet: 'snippet',
});

describe('citation markers', () => {
  it('links known markers, including adjacent ones', () => {
    const out = linkCitations('You felt calm by the sea [1][2]. Later [3].', [cite(1), cite(2)]);
    expect(out).toBe(`You felt calm by the sea [1](${CITE_PREFIX}1)[2](${CITE_PREFIX}2). Later [3].`);
  });

  it('leaves real markdown links, reference definitions and code alone', () => {
    const src = 'See [1](https://example.com) and `[1]` and\n```\n[1]\n```\n[1]: note, but [1] here.';
    const out = linkCitations(src, [cite(1)]);
    expect(out).toContain('[1](https://example.com)');
    expect(out).toContain('`[1]`');
    expect(out).toContain('```\n[1]\n```');
    expect(out).toContain('[1]: note');
    expect(out).toContain(`[1](${CITE_PREFIX}1) here.`);
  });

  it('lists cited numbers in order of first appearance', () => {
    expect(citedNumbers('[2] then [1] then [2] and [9]', [cite(1), cite(2)])).toEqual([2, 1]);
  });

  it('parses marker hrefs strictly', () => {
    expect(citationFromHref(`${CITE_PREFIX}3`)).toBe(3);
    expect(citationFromHref(`${CITE_PREFIX}0`)).toBeNull();
    expect(citationFromHref('https://example.com/cite/3')).toBeNull();
    expect(citationFromHref(`${CITE_PREFIX}x`)).toBeNull();
  });
});

describe('stableStreamText', () => {
  it('cuts to the last word boundary', () => {
    expect(stableStreamText('You wrote about the se')).toBe('You wrote about the ');
  });
  it('hides a dangling bold marker until it closes', () => {
    expect(stableStreamText('It was **really calm')).toBe('It was ');
    expect(stableStreamText('It was **really** calm ')).toBe('It was **really** calm ');
  });
  it('hides an unfinished link or citation', () => {
    expect(stableStreamText('as you said [1')).toBe('as you said ');
  });
  it('hides an unclosed code span', () => {
    expect(stableStreamText('try `some code here')).toBe('try ');
  });
  it('returns everything once final', () => {
    expect(stableStreamText('done **now', true)).toBe('done **now');
  });
});
