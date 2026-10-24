import { describe, expect, it } from 'vitest';
import { describeCorrelation, topPatterns } from './patternWording';

const c = (tag: string, entries: number, delta: number, baseline = 0.4) => ({ tag, entries, delta, baseline, avgMood: baseline + delta });

describe('correlation wording', () => {
  it('ignores thin or tiny patterns', () => {
    expect(describeCorrelation(c('a', 2, 1))).toBeNull();
    expect(describeCorrelation(c('a', 9, 0.2))).toBeNull();
  });
  it('says often for moderate and usually for strong, never causal', () => {
    const mid = describeCorrelation(c('walks', 5, 0.5))!;
    const strong = describeCorrelation(c('walks', 5, 0.8))!;
    expect(mid.strength).toBe('often');
    expect(strong.strength).toBe('usually');
    expect(strong.text).toBe('Days with walks were usually calmer and brighter than your usual.');
    expect(strong.text).not.toMatch(/because|cause|makes you/i);
    expect(strong.figure).toBe('+1.2 vs your usual +0.4');
  });
  it('describes lower days gently', () => {
    const low = describeCorrelation(c('deadlines', 6, -0.9, 0.2))!;
    expect(low.direction).toBe('down');
    expect(low.text).toContain('a little heavier');
    expect(low.figure).toBe('−0.7 vs your usual +0.2');
  });
  it('sorts by strength and limits', () => {
    const list = topPatterns([c('a', 4, 0.4), c('b', 4, -1.1), c('c', 4, 0.9), c('d', 1, 2)], 2);
    expect(list.map((p) => p.tag)).toEqual(['b', 'c']);
  });
});
