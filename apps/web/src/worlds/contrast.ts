/**
 * World validator: parses a world's tokens.css and checks that it defines every token for both
 * themes and that every text/background pair the UI actually uses meets WCAG AA (4.5:1 text,
 * 3:1 UI graphics and large text). contrast.test.ts runs it over every world × theme in CI.
 *
 * Colour tokens must be literal colours the parser understands (hex, rgb(), hsl(), oklch(),
 * oklab(), color(srgb …)) or var() references to other tokens. Translucent fills (the -soft
 * tints) are composited over the surface they sit on before measuring.
 */
import { composite, contrast, mixOklab, parseColor, type RGBA } from '../lib/color.ts';

export type ThemeName = 'light' | 'dark';
export type WorldTokens = { shared: Record<string, string>; light: Record<string, string>; dark: Record<string, string> };

/** Theme-independent tokens every world defines on [data-world='<id>']. */
export const SHARED_TOKENS = [
  '--font-display', '--font-heading', '--font-prose', '--font-ui', '--font-mono',
  '--weight-display', '--weight-title', '--weight-heading',
  '--stretch-display', '--stretch-heading',
  '--tracking-display', '--tracking-title', '--tracking-heading', '--tracking-brand',
  '--leading-display', '--leading-body', '--leading-prose', '--leading-reading', '--leading-markdown',
  '--text-micro', '--text-caption', '--text-xs', '--text-label', '--text-sm', '--text-meta', '--text-excerpt',
  '--text-note', '--text-reading', '--text-base', '--text-prose', '--text-lg', '--text-prose-lg', '--text-brand', '--text-xl',
  '--text-section', '--text-title', '--text-2xl', '--text-3xl', '--text-4xl', '--text-5xl',
  '--spacing',
  '--radius-mark', '--radius-inner', '--radius-control', '--radius-card', '--radius-sheet', '--radius-pill',
  '--dur-1', '--dur-2', '--dur-3', '--dur-4', '--ease-standard', '--ease-emphasized', '--dur-spring', '--ease-spring',
  '--focus-ring-width', '--focus-ring-offset', '--focus-ring-radius',
  '--texture-size', '--texture-blend',
] as const;

/** Tokens every world defines once per theme on [data-world='<id>'][data-theme='light|dark']. */
export const THEMED_TOKENS = [
  'color-scheme',
  '--canvas', '--surface', '--raised', '--sunken', '--line', '--line-strong',
  '--fg', '--fg-muted', '--fg-faint',
  '--accent', '--accent-fg', '--accent-soft', '--accent-glow',
  '--ai', '--ai-soft', '--danger', '--danger-soft', '--success', '--focus',
  '--mood-1', '--mood-2', '--mood-3', '--mood-4', '--mood-5',
  '--shadow-1', '--shadow-2', '--shadow-3', '--shadow-overlay', '--highlight-inset',
  '--texture', '--texture-opacity',
] as const;

const FILLS = ['canvas', 'surface', 'raised', 'sunken'] as const;

/** A background: a token, or a translucent token composited over another. */
type Bg = string | { tint: string; over: string };
export type ContrastRule = { fg: string; bg: Bg; min: number; why: string };

function rules(): ContrastRule[] {
  const out: ContrastRule[] = [];
  for (const fg of ['fg', 'fg-muted', 'fg-faint', 'accent', 'ai', 'danger']) {
    for (const bg of FILLS) out.push({ fg, bg, min: 4.5, why: 'text on a fill' });
  }
  out.push(
    { fg: 'accent-fg', bg: 'accent', min: 4.5, why: 'primary button label' },
    { fg: 'canvas', bg: 'danger', min: 4.5, why: 'danger button label' },
    { fg: 'canvas', bg: 'ai', min: 4.5, why: 'citation marker, hovered' },
  );
  for (const tint of ['accent-soft', 'ai-soft', 'danger-soft']) {
    for (const over of ['canvas', 'surface']) out.push({ fg: 'fg', bg: { tint, over }, min: 4.5, why: 'text on a tint' });
  }
  for (const over of ['canvas', 'surface']) {
    out.push({ fg: 'accent', bg: { tint: 'accent-soft', over }, min: 4.5, why: 'accent link in an accent banner' });
    out.push({ fg: 'ai', bg: { tint: 'ai-soft', over }, min: 4.5, why: 'Solace label on its own tint' });
  }
  out.push({ fg: 'danger', bg: { tint: 'danger-soft', over: 'canvas' }, min: 4.5, why: 'error text in an error box' });
  for (const fg of ['focus', 'success', 'accent', 'ai', 'danger']) {
    for (const bg of FILLS) out.push({ fg, bg, min: 3, why: 'UI graphic (WCAG 1.4.11)' });
  }
  for (const bg of ['sunken', 'surface', 'raised']) out.push({ fg: 'control-edge', bg, min: 3, why: 'form control boundary' });
  return out;
}
export const CONTRAST_RULES: readonly ContrastRule[] = rules();

/** Strips comments and returns top-level `selector { body }` rules (at-rules skipped). */
function topLevelRules(css: string): { selector: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    if (!selector.startsWith('@')) out.push({ selector, body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Split on semicolons outside parentheses (linear(), rgb(), data: URLs…).
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const decl = body.slice(start, end).trim();
    const colon = decl.indexOf(':');
    if (colon > 0) out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
  };
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      push(k);
      start = k + 1;
    }
  }
  push(body.length);
  return out;
}

/** Reads one world's tokens from its tokens.css. */
export function parseWorldTokens(css: string, world: string): WorldTokens {
  const tokens: WorldTokens = { shared: {}, light: {}, dark: {} };
  const marker = `[data-world='${world}']`;
  for (const { selector, body } of topLevelRules(css)) {
    const parts = selector.split(',').map((s) => s.trim()).filter((s) => s.includes(marker));
    if (!parts.length) continue;
    const decls = declarations(body);
    for (const part of parts) {
      const target = part.includes("[data-theme='dark']") ? tokens.dark : part.includes("[data-theme='light']") ? tokens.light : tokens.shared;
      Object.assign(target, decls);
    }
  }
  return tokens;
}

/** Resolves var() chains within a theme (theme values first, then shared). */
export function tokenValue(tokens: WorldTokens, theme: ThemeName, name: string, seen = new Set<string>()): string | undefined {
  const raw = tokens[theme][name] ?? tokens.shared[name];
  if (raw === undefined) return undefined;
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (!ref) return raw;
  if (seen.has(ref[1]!)) return undefined;
  seen.add(ref[1]!);
  return tokenValue(tokens, theme, ref[1]!, seen);
}

export type Failure = { theme: ThemeName; message: string };

function color(tokens: WorldTokens, theme: ThemeName, name: string): RGBA | null {
  if (name === 'control-edge') {
    const faint = color(tokens, theme, 'fg-faint');
    const sunken = color(tokens, theme, 'sunken');
    return faint && sunken ? mixOklab(faint, sunken, 0.8) : null;
  }
  const value = tokenValue(tokens, theme, `--${name}`);
  return value ? parseColor(value) : null;
}

/** Every missing token and every pair below its minimum, for both themes. */
export function validateWorld(tokens: WorldTokens): Failure[] {
  const failures: Failure[] = [];
  for (const name of SHARED_TOKENS) {
    if (tokens.shared[name] === undefined) failures.push({ theme: 'light', message: `missing shared token ${name}` });
  }
  for (const theme of ['light', 'dark'] as const) {
    for (const name of THEMED_TOKENS) {
      if (tokens[theme][name] === undefined) failures.push({ theme, message: `missing ${name}` });
    }
    if (tokens[theme]['color-scheme'] !== undefined && tokens[theme]['color-scheme'] !== theme) {
      failures.push({ theme, message: `color-scheme should be ${theme}` });
    }
    for (const rule of CONTRAST_RULES) {
      const fg = color(tokens, theme, rule.fg);
      const bgName = typeof rule.bg === 'string' ? rule.bg : rule.bg.tint;
      let bg = color(tokens, theme, bgName);
      if (typeof rule.bg !== 'string') {
        const under = color(tokens, theme, rule.bg.over);
        bg = bg && under ? composite(bg, under) : null;
      }
      if (!fg || !bg) {
        failures.push({ theme, message: `can't read colours for ${rule.fg} on ${JSON.stringify(rule.bg)}` });
        continue;
      }
      if (bg.a < 1) bg = composite(bg, color(tokens, theme, 'canvas') ?? { r: 0, g: 0, b: 0, a: 1 });
      const ratio = contrast(fg, bg);
      if (ratio < rule.min) {
        const where = typeof rule.bg === 'string' ? rule.bg : `${rule.bg.tint} over ${rule.bg.over}`;
        failures.push({ theme, message: `${rule.fg} on ${where}: ${ratio.toFixed(2)} < ${rule.min} (${rule.why})` });
      }
    }
  }
  return failures;
}

/** Contrast of one pair in one theme (for tooling and the world agents' design loops). */
export function pairContrast(tokens: WorldTokens, theme: ThemeName, fg: string, bg: string): number | null {
  const a = color(tokens, theme, fg);
  const b = color(tokens, theme, bg);
  return a && b ? contrast(a, b) : null;
}
