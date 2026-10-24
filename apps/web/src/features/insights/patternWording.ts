import type { Correlation } from '@solace/shared';

/** Fewest entries with a tag before it may appear as a pattern. */
export const MIN_TAG_ENTRIES = 3;
/** Smallest mood difference (on the -2..+2 scale) worth mentioning. */
export const MIN_DELTA = 0.3;
/** At or above this, the wording moves from "often" to "usually". */
export const STRONG_DELTA = 0.7;

export type PatternView = {
  tag: string;
  direction: 'up' | 'down';
  strength: 'often' | 'usually';
  text: string;
  figure: string;
  entries: number;
  delta: number;
};

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/** Plain, non-causal wording for one tag. Returns null when the pattern is too weak or thin to mention. */
export function describeCorrelation(c: Correlation): PatternView | null {
  if (c.entries < MIN_TAG_ENTRIES || Math.abs(c.delta) < MIN_DELTA) return null;
  const direction = c.delta > 0 ? 'up' : 'down';
  const strength = Math.abs(c.delta) >= STRONG_DELTA ? 'usually' : 'often';
  const feel = direction === 'up' ? 'calmer and brighter' : 'a little heavier';
  return {
    tag: c.tag,
    direction,
    strength,
    entries: c.entries,
    delta: c.delta,
    text: `Days with ${c.tag} were ${strength} ${feel} than your usual.`,
    figure: `${signed(c.avgMood)} vs your usual ${signed(c.baseline)}`,
  };
}

export function topPatterns(items: Correlation[], limit = 5): PatternView[] {
  return items
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map(describeCorrelation)
    .filter((p): p is PatternView => p !== null)
    .slice(0, limit);
}
