import { describe, expect, it } from 'vitest';
import type { Chapter } from '@solace/shared';
import { MIN_BLOCK_PX, clampZoom, daysBetween, layoutChapters, roleVar } from './layout';

const ch = (id: number, from: string, to: string | null): Chapter => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  title: `C${id}`,
  summary: 's',
  from,
  to,
  color: 'mood-4',
  cast: [],
  keyEntryIds: [],
});

describe('chapter timeline layout', () => {
  it('measures days', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
  it('places chapters left to right, one lane when they follow each other', () => {
    const l = layoutChapters([ch(2, '2026-04-01', null), ch(1, '2026-01-01', '2026-03-31')], '2026-06-30', 3);
    expect(l.items.map((i) => i.chapter.title)).toEqual(['C1', 'C2']);
    expect(l.items[0]).toMatchObject({ left: 0, width: 270, lane: 0 });
    expect(l.items[1]).toMatchObject({ left: 270, lane: 0, ongoing: true });
    expect(l.lanes).toBe(1);
    expect(l.width).toBe(l.items[1]!.left + l.items[1]!.width + 24);
  });
  it('keeps a readable minimum width and stacks overlaps into lanes', () => {
    const l = layoutChapters([ch(1, '2026-01-01', '2026-01-10'), ch(2, '2026-01-05', '2026-02-01')], '2026-03-01', 1);
    expect(l.items[0]!.width).toBe(MIN_BLOCK_PX);
    expect(l.items[1]!.lane).toBe(1);
    expect(l.lanes).toBe(2);
  });
  it('is empty without chapters and clamps zoom', () => {
    expect(layoutChapters([], '2026-01-01', 1).items).toEqual([]);
    expect(clampZoom(-3)).toBe(0);
    expect(clampZoom(99)).toBe(3);
  });
  it('produces month ticks and falls back to the accent for unknown roles', () => {
    const l = layoutChapters([ch(1, '2026-01-01', '2026-06-01')], '2026-06-01', 2.8);
    expect(l.ticks.length).toBe(6);
    // Zoomed out, labels thin out so a "Jan 2026" tick never runs into the next one.
    const thin = layoutChapters([ch(1, '2025-11-01', '2026-10-01')], '2026-10-01', 1.4);
    for (let i = 1; i < thin.ticks.length; i++) expect(thin.ticks[i]!.left - thin.ticks[i - 1]!.left).toBeGreaterThanOrEqual(72);
    expect(roleVar('mood-2')).toBe('var(--mood-2)');
    expect(roleVar('#ff0000')).toBe('var(--accent)');
  });
});
