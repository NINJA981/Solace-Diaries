/**
 * Chrome's Memory Constellation: glowing chrome orbs joined by precise hairlines, on a faint
 * instrument grid, labelled in mono. Each orb is one pre-rendered sprite per family (halo, lit
 * sphere, specular dot), so a frame is a handful of drawImage calls: no shadowBlur, no gradients
 * allocated per frame. Nothing here moves (drift 0), so it is already still under reduced motion.
 */
import { mixOklab, rgba, type RGBA } from '@/lib/color';
import type { ConstellationSkin, SkinCache, SkinColors } from '@/features/insights/skin';

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: RGBA = { r: 6, g: 9, b: 14, a: 1 };
const GRID = 28;

/** A sphere of the family colour: lit from the top left, rimmed, with a soft halo around it. */
function orbSprite(color: RGBA, dpr: number, light: boolean): HTMLCanvasElement | undefined {
  const px = Math.ceil(96 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (!g) return undefined;
  const mid = px / 2;
  const core = px * 0.17; // sphere radius, as a share of the sprite
  const halo = g.createRadialGradient(mid, mid, core * 0.6, mid, mid, mid);
  halo.addColorStop(0, rgba(color, light ? 0.22 : 0.5));
  halo.addColorStop(0.4, rgba(color, light ? 0.06 : 0.14));
  halo.addColorStop(1, rgba(color, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, px, px);

  const body = g.createRadialGradient(mid - core * 0.4, mid - core * 0.45, core * 0.1, mid, mid, core);
  body.addColorStop(0, rgba(mixOklab(color, WHITE, 0.75), 1));
  body.addColorStop(0.45, rgba(color, 1));
  body.addColorStop(1, rgba(mixOklab(color, BLACK, light ? 0.35 : 0.55), 1));
  g.fillStyle = body;
  g.beginPath();
  g.arc(mid, mid, core, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = rgba(mixOklab(color, WHITE, 0.55), 0.9);
  g.lineWidth = Math.max(1, dpr * 0.75);
  g.beginPath();
  g.arc(mid, mid, core, 0, Math.PI * 2);
  g.stroke();
  return c;
}

export const chromeSkin: ConstellationSkin = {
  id: 'chrome-orbs',
  familyTokens: { world: '--accent', aims: '--ai', feelings: '--fg' },
  drift: 0,
  prepare(colors: SkinColors, dpr: number): SkinCache {
    return {
      world: orbSprite(colors.world, dpr, colors.light),
      aims: orbSprite(colors.aims, dpr, colors.light),
      feelings: orbSprite(colors.feelings, dpr, colors.light),
    };
  },
  background({ ctx, width, height, colors }) {
    ctx.clearRect(0, 0, width, height);
    // Instrument grid: hairline crosses at a fixed pitch, quiet enough to disappear behind data.
    ctx.fillStyle = rgba(colors.line, colors.light ? 0.7 : 0.55);
    for (let y = GRID / 2; y < height; y += GRID) {
      for (let x = GRID / 2; x < width; x += GRID) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  },
  edge({ ctx, colors }, a, b, { active, strength }) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(active ? colors.ring : colors.line);
    ctx.globalAlpha = active ? 0.95 : 0.3 + 0.4 * strength;
    ctx.lineWidth = active ? 1 : 0.75;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  node({ ctx }, star, { x, y }, { dimmed }, cache) {
    const sprite = cache[star.family];
    if (!sprite) return;
    // The sphere is 17% of the sprite wide, so scale the sprite to put the sphere at the star's radius.
    const size = (star.r / 0.17) * 1.0;
    ctx.globalAlpha = dimmed ? 0.55 : 1;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
  },
  ring({ ctx, colors }, star, { x, y }) {
    ctx.strokeStyle = rgba(colors.ring);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, star.r + 5, 0, Math.PI * 2);
    ctx.stroke();
    // Tick marks at the four compass points: a reticle, not a halo.
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(x + dx * (star.r + 5), y + dy * (star.r + 5));
      ctx.lineTo(x + dx * (star.r + 9), y + dy * (star.r + 9));
    }
    ctx.stroke();
  },
  label: {
    font: () => `500 10.5px 'Martian Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
    color: (f) => f.colors.label,
    gap: 8,
  },
};
