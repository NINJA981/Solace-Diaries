import { describe, expect, it } from 'vitest';
import type { DayStat, Graph } from '@solace/shared';
import { describeAvg, niceMax, toWeekRows } from './moodData';
import { layoutConstellation, MAX_STARS } from './constellationLayout';
import { EMPTY_FILL, cellFill, cellLabel } from './YearHeatmap';

describe('mood bands', () => {
  it('folds moods into heavy / steady / bright by valence', () => {
    const [row] = toWeekRows([
      { weekStart: '2026-10-05', avgScore: 0.5, counts: { joyful: 2, calm: 1, reflective: 1, sad: 1, anxious: 2, bogus: 9 } },
    ]);
    expect(row).toEqual({ weekStart: '2026-10-05', avg: 0.5, low: 3, neutral: 1, bright: 3, total: 7 });
  });
  it('describes averages in words', () => {
    expect(describeAvg(null)).toBe('no moods recorded');
    expect(describeAvg(1.5)).toBe('very bright');
    expect(describeAvg(0)).toBe('steady');
    expect(describeAvg(-0.8)).toBe('mostly heavy');
  });
  it('rounds the count axis to clean numbers', () => {
    expect([1, 5, 7, 12, 23].map(niceMax)).toEqual([4, 6, 10, 15, 25]);
  });
});

describe('heatmap cells', () => {
  const day = (p: Partial<DayStat>): DayStat => ({ date: '2026-03-03', count: 1, words: 10, moodScore: null, mood: null, ...p });
  it('colors by mood valence when known, else lamp by count', () => {
    expect(cellFill(undefined).fill).toBe(EMPTY_FILL);
    expect(cellFill(day({ moodScore: 1.6, mood: 'joyful' })).fill).toBe('var(--mood-5)');
    expect(cellFill(day({ moodScore: -0.4 })).fill).toBe('var(--mood-3)');
    expect(cellFill(day({ count: 2 }))).toEqual({ fill: 'var(--lamp)', opacity: 0.7 });
  });
  it('labels cells for screen readers', () => {
    expect(cellLabel('2026-03-03', day({ count: 2, mood: 'calm' }))).toMatch(/March 3, 2026: 2 entries, mostly calm$/);
    expect(cellLabel('2026-03-03', undefined)).toMatch(/no entries$/);
  });
});

describe('constellation layout', () => {
  const graph = (n: number): Graph => ({
    nodes: Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `n${i}`,
      kind: (['person', 'place', 'goal', 'emotion'] as const)[i % 4]!,
      weight: n - i,
    })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({
      source: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      target: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      weight: 1,
    })),
  });
  it('is deterministic and normalized to the unit square', () => {
    const a = layoutConstellation(graph(30));
    const b = layoutConstellation(graph(30));
    expect(a.stars.map((s) => [s.x, s.y])).toEqual(b.stars.map((s) => [s.x, s.y]));
    for (const s of a.stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.y)).toBe(true);
    }
    expect(a.links).toHaveLength(29);
  });
  it('caps the sky to the heaviest nodes and drops dangling edges', () => {
    const big = layoutConstellation(graph(MAX_STARS + 20));
    expect(big.stars).toHaveLength(MAX_STARS);
    expect(big.links.every((l) => l.a < MAX_STARS && l.b < MAX_STARS)).toBe(true);
    expect(big.stars[0]!.family).toBe('world');
  });
});
