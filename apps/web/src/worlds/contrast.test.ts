/**
 * Every world × theme: all tokens defined, every text/background pair at WCAG AA (4.5:1 text,
 * 3:1 UI), browser colours in sync with the canvas, and the CSS spring matching the manifest.
 * World agents: run `npm run check:worlds -w @solace/web` for a readable table while designing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORLDS } from '@solace/shared';
import { parseLinear, springAt, springToLinear } from '@/lib/motion/spring';
import { CONTRAST_RULES, parseWorldTokens, tokenValue, validateWorld } from './contrast';
import themeColors from './theme-colors.json';
import { worlds } from '.';

// Read from disk: Vitest's CSS pipeline empties stylesheet imports, even ?raw ones.
const cssFor = (id: string) => {
  const file = join(dirname(fileURLToPath(import.meta.url)), id, 'tokens.css');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

describe('world tokens', () => {
  it('has a tokens.css for every world in the contract', () => {
    for (const id of WORLDS) expect(cssFor(id), id).toBeTypeOf('string');
  });

  it('checks a meaningful set of pairs', () => {
    expect(CONTRAST_RULES.length).toBeGreaterThan(50);
  });

  for (const id of WORLDS) {
    describe(id, () => {
      const tokens = parseWorldTokens(cssFor(id) ?? '', id);

      it('defines every token and passes AA in light and dark', () => {
        expect(validateWorld(tokens).map((f) => `${f.theme}: ${f.message}`)).toEqual([]);
      });

      it('keeps the browser colour (theme-colors.json) equal to --canvas', () => {
        const colors = (themeColors as Record<string, { light: string; dark: string }>)[id]!;
        expect(tokenValue(tokens, 'light', '--canvas')?.toLowerCase()).toBe(colors.light.toLowerCase());
        expect(tokenValue(tokens, 'dark', '--canvas')?.toLowerCase()).toBe(colors.dark.toLowerCase());
        expect(worlds[id].themeColor).toEqual(colors);
      });

      it('never shrinks touch targets: density at least Lamplight’s', () => {
        const spacing = parseFloat(tokenValue(tokens, 'light', '--spacing') ?? '0');
        expect(spacing).toBeGreaterThanOrEqual(0.25);
      });

      it('carries the manifest spring as its CSS linear() easing', () => {
        const css = tokenValue(tokens, 'light', '--ease-spring') ?? '';
        const points = parseLinear(css);
        expect(points.length).toBeGreaterThan(5);
        const { durationMs } = springToLinear(worlds[id].motion.spring);
        expect(tokenValue(tokens, 'light', '--dur-spring')).toBe(`${durationMs}ms`);
        for (const p of points.filter((q) => Number.isFinite(q.x) && q.x > 0 && q.x < 1)) {
          expect(Math.abs(p.y - springAt(worlds[id].motion.spring, (p.x * durationMs) / 1000))).toBeLessThan(0.01);
        }
      });
    });
  }
});

describe('validator', () => {
  const css = `[data-world='x'] { --spacing: 0.25rem; }
    [data-world='x'][data-theme='light'] { --canvas: #ffffff; --fg: #777777; --fg-muted: var(--fg); }
    [data-world='x'][data-theme='dark'] { --canvas: #000000; }`;
  const tokens = parseWorldTokens(css, 'x');

  it('resolves var() chains and reports failing pairs and missing tokens', () => {
    expect(tokenValue(tokens, 'light', '--fg-muted')).toBe('#777777');
    const messages = validateWorld(tokens).map((f) => f.message);
    expect(messages).toContain('missing --surface');
    expect(messages.some((m) => m.startsWith('fg on canvas: 4.48 < 4.5'))).toBe(true);
  });
});
