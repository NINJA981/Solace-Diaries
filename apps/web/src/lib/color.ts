/**
 * Colour maths with no DOM: parse any common CSS colour string to sRGB, mix, composite and
 * measure WCAG contrast. Used by the canvas skins (via `resolveColor` in color-dom.ts) and by
 * the world contrast validator.
 *
 *   parseColor('#e3b65e') → { r: 227, g: 182, b: 94, a: 1 }
 *   parseColor('rgb(227 182 94 / 0.14)'), 'hsl(…)', 'oklch(…)', 'oklab(…)', 'color(srgb …)'
 *   contrast(a, b) → 1..21 (alpha is composited over `b` first)
 */

/** 0-255 channels, alpha 0-1. */
export type RGBA = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, RGBA> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A number, a percentage (of `percentOf`) or `none` (0). */
function num(token: string, percentOf = 1): number {
  if (token === 'none') return 0;
  if (token.endsWith('%')) return (parseFloat(token) / 100) * percentOf;
  return parseFloat(token);
}

function hue(token: string): number {
  if (token === 'none') return 0;
  const v = parseFloat(token);
  if (token.endsWith('turn')) return v * 360;
  if (token.endsWith('grad')) return v * 0.9;
  if (token.endsWith('rad')) return (v * 180) / Math.PI;
  return v;
}

/** Splits `fn(a b c / d)` or `fn(a, b, c, d)` into channel tokens and an optional alpha token. */
function args(body: string): { parts: string[]; alpha?: string } {
  const [main = '', alpha] = body.split('/').map((s) => s.trim());
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (alpha === undefined && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts, alpha };
}

function alphaOf(token: string | undefined): number {
  return token === undefined ? 1 : clamp(num(token), 0, 1);
}

const toByte = (v: number) => Math.round(clamp(v, 0, 1) * 255);

function fromLinear(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function oklabToRgb(L: number, a: number, b: number, alpha: number): RGBA {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: toByte(fromLinear(r)), g: toByte(fromLinear(g)), b: toByte(fromLinear(bl)), a: alpha };
}

export function rgbToOklab({ r, g, b }: RGBA): [number, number, number] {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function hslToRgb(h: number, s: number, l: number, a: number): RGBA {
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: toByte(f(0)), g: toByte(f(8)), b: toByte(f(4)), a };
}

/** Parses hex, rgb(a), hsl(a), oklab, oklch, color(srgb …) and a few keywords. Null if unknown. */
export function parseColor(input: string): RGBA | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value in NAMED) return { ...NAMED[value]! };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
  }

  const fn = /^([a-z-]+)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const [, name, body = ''] = fn;
  if (name === 'rgb' || name === 'rgba') {
    const { parts, alpha } = args(body);
    if (parts.length !== 3) return null;
    const [r, g, b] = parts.map((p) => clamp(num(p, 255), 0, 255));
    return { r: Math.round(r!), g: Math.round(g!), b: Math.round(b!), a: alphaOf(alpha) };
  }
  if (name === 'hsl' || name === 'hsla') {
    const { parts, alpha } = args(body);
    if (parts.length !== 3) return null;
    const s = parts[1]!.endsWith('%') ? num(parts[1]!) : parseFloat(parts[1]!) / 100;
    const l = parts[2]!.endsWith('%') ? num(parts[2]!) : parseFloat(parts[2]!) / 100;
    return hslToRgb(((hue(parts[0]!) % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1), alphaOf(alpha));
  }
  if (name === 'oklab') {
    const { parts, alpha } = args(body);
    if (parts.length !== 3) return null;
    return oklabToRgb(num(parts[0]!), num(parts[1]!, 0.4), num(parts[2]!, 0.4), alphaOf(alpha));
  }
  if (name === 'oklch') {
    const { parts, alpha } = args(body);
    if (parts.length !== 3) return null;
    const L = num(parts[0]!);
    const C = num(parts[1]!, 0.4);
    const H = (hue(parts[2]!) * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), alphaOf(alpha));
  }
  if (name === 'color') {
    const [main = '', alpha] = body.split('/').map((s) => s.trim());
    const parts = main.split(/\s+/).filter(Boolean);
    if (parts.length !== 4 || (parts[0] !== 'srgb' && parts[0] !== 'srgb-linear')) return null;
    const ch = parts.slice(1).map((p) => num(p));
    const enc = parts[0] === 'srgb' ? (c: number) => c : fromLinear;
    return { r: toByte(enc(ch[0]!)), g: toByte(enc(ch[1]!)), b: toByte(enc(ch[2]!)), a: alphaOf(alpha) };
  }
  return null;
}

/** `top` drawn over an opaque `bottom` (source-over). */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return {
    r: Math.round(top.r * a + bottom.r * (1 - a)),
    g: Math.round(top.g * a + bottom.g * (1 - a)),
    b: Math.round(top.b * a + bottom.b * (1 - a)),
    a: 1,
  };
}

/** CSS `color-mix(in oklab, a p, b)` for opaque colours, `p` in 0..1. */
export function mixOklab(a: RGBA, b: RGBA, p: number): RGBA {
  const [l1, a1, b1] = rgbToOklab(a);
  const [l2, a2, b2] = rgbToOklab(b);
  return oklabToRgb(l1 * p + l2 * (1 - p), a1 * p + a2 * (1 - p), b1 * p + b2 * (1 - p), 1);
}

/** WCAG 2 relative luminance of an opaque colour. */
export function luminance({ r, g, b }: RGBA): number {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

/** WCAG contrast ratio; a translucent foreground is composited over the background first. */
export function contrast(fg: RGBA, bg: RGBA): number {
  const base = bg.a < 1 ? composite(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
  const top = fg.a < 1 ? composite(fg, base) : fg;
  const [hi, lo] = [luminance(top), luminance(base)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** True for colours that read as light (paper) rather than dark (ink): perceived brightness > 150/255. */
export function isLightColor({ r, g, b }: RGBA): boolean {
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}

export function rgba({ r, g, b, a }: RGBA, alpha = a): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

export function toHex({ r, g, b }: RGBA): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
