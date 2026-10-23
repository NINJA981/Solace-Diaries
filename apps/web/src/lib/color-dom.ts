/**
 * Resolving design tokens to concrete colours for canvas drawing. A probe element inside the
 * target's subtree asks the browser for the computed colour, so whatever the world wrote (hex,
 * rgb, oklch, color-mix(), light-dark()…) and whichever [data-world]/[data-theme] the element
 * sits in, the canvas gets the same colour CSS would paint. Strings parseColor() can't read are
 * drawn onto a 1×1 canvas and read back as pixels.
 */
import { parseColor, type RGBA } from './color';

let scratch: CanvasRenderingContext2D | null | undefined;
function pixelOf(css: string): RGBA | null {
  if (scratch === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      scratch = c.getContext('2d', { willReadFrequently: true });
    } catch {
      scratch = null;
    }
  }
  if (!scratch) return null;
  // Detect strings the canvas rejects: fillStyle keeps its previous value when assigned junk.
  scratch.fillStyle = '#010203';
  scratch.fillStyle = css;
  if (String(scratch.fillStyle) === '#010203' && !/^#010203$/i.test(css.trim())) return null;
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = scratch.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: Math.round((a / 255) * 1000) / 1000 };
}

/** Any CSS colour string → RGBA (null if neither the parser nor the canvas understands it). */
export function toRGBA(css: string): RGBA | null {
  return parseColor(css) ?? pixelOf(css);
}

/**
 * Resolves tokens (`--accent`) or colour expressions as seen from `scope`. One probe, one style
 * recalculation per call, so batch tokens into a single call.
 */
export function resolveColors<K extends string>(tokens: Record<K, string>, scope: Element = document.documentElement): Record<K, RGBA | null> {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
  scope.appendChild(probe);
  const out = {} as Record<K, RGBA | null>;
  try {
    for (const key of Object.keys(tokens) as K[]) {
      const value = tokens[key];
      probe.style.color = '';
      probe.style.color = value.startsWith('--') ? `var(${value})` : value;
      out[key] = toRGBA(getComputedStyle(probe).color);
    }
  } finally {
    probe.remove();
  }
  return out;
}

/** A custom property's computed value as seen from `scope` (for non-colour tokens like fonts). */
export function readToken(name: string, scope: Element = document.documentElement): string {
  return getComputedStyle(scope).getPropertyValue(name).trim();
}
