import { describe, expect, it } from 'vitest';
import type { ResurfaceItem } from '@solace/shared';
import { toCards } from './mapping';

const item = (n: number, kind: ResurfaceItem['kind'], title = `T${n}`, excerpt = 'Some words here.'): ResurfaceItem => ({
  kind,
  reason: `reason ${n}`,
  entry: {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    title,
    excerpt,
    entryDate: '2025-10-14',
    mood: null,
    moodSource: null,
    tags: [],
    summary: null,
    wordCount: 3,
    version: 1,
    enrichmentStatus: 'ready',
    createdAt: '2025-10-14T08:00:00.000Z',
    updatedAt: '2025-10-14T08:00:00.000Z',
    attachmentCount: 0,
  },
});

describe('toCards', () => {
  it('is empty for nothing', () => {
    expect(toCards(undefined)).toEqual([]);
    expect(toCards([])).toEqual([]);
  });
  it('puts on this day first, then unfinished, caps at three and dedupes entries', () => {
    const cards = toCards([item(1, 'echo'), item(2, 'unfinished'), item(3, 'on_this_day'), item(4, 'echo'), item(3, 'echo')]);
    expect(cards.map((c) => c.title)).toEqual(['T3', 'T2', 'T1']);
    expect(cards[0]?.reason).toBe('reason 3');
  });
  it('falls back to the excerpt when untitled', () => {
    const [c] = toCards([item(1, 'echo', '  ', 'A quiet walk by the water today.')]);
    expect(c?.title).toBe('A quiet walk by the water today.');
    expect(c?.excerpt).toBe('');
  });
});
