/**
 * Jelly's Memory Constellation: gummy sweets. Each node is a glossy blob sized by how much it
 * weighs in the journal, linked by dotted bubblegum strings. One sprite per family is
 * pre-rendered (body, shading, gloss) and drawn scaled, so a frame is a few drawImage calls
 * with no shadowBlur. Nodes breathe a little while motion is allowed and sit still otherwise.
 */
import { mixOklab, rgba, type RGBA } from '@/lib/color';
import type { ConstellationSkin, SkinCache, SkinColors } from '@/features/insights/skin';

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: RGBA = { r: 20, g: 6, b: 30, a: 1 };
const SPRITE = 64;

function gummy(color: RGBA, dpr: number): HTMLCanvasElement | undefined {
  const size = Math.ceil(SPRITE * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return undefined;
  const mid = size / 2;
  const radius = size * 0.43;

  // Soft contact shadow under the sweet.
  g.fillStyle = rgba(BLACK, 0.16);
  g.beginPath();
  g.ellipse(mid, mid + radius * 0.82, radius * 0.78, radius * 0.2, 0, 0, Math.PI * 2);
  g.fill();

  // Body: lit from the top left, darker toward the bottom right like jelly with light through it.
  const body = g.createRadialGradient(mid - radius * 0.35, mid - radius * 0.4, radius * 0.1, mid, mid, radius * 1.05);
  body.addColorStop(0, rgba(mixOklab(color, WHITE, 0.62)));
  body.addColorStop(0.45, rgba(color));
  body.addColorStop(1, rgba(mixOklab(color, BLACK, 0.68)));
  g.fillStyle = body;
  g.beginPath();
  g.arc(mid, mid - radius * 0.06, radius, 0, Math.PI * 2);
  g.fill();

  // Rim, so the shape holds on any background.
  g.lineWidth = Math.max(1, size * 0.03);
  g.strokeStyle = rgba(mixOklab(color, BLACK, 0.45), 0.9);
  g.stroke();

  // Gloss: a big soft highlight and a small sharp one.
  g.fillStyle = rgba(WHITE, 0.62);
  g.beginPath();
  g.ellipse(mid - radius * 0.34, mid - radius * 0.52, radius * 0.34, radius * 0.17, -0.55, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgba(WHITE, 0.8);
  g.beginPath();
  g.arc(mid + radius * 0.4, mid - radius * 0.5, radius * 0.07, 0, Math.PI * 2);
  g.fill();
  return c;
}

export const jellySkin: ConstellationSkin = {
  id: 'gummies',
  familyTokens: { world: '--accent', aims: '--ai', feelings: '--mood-2' },
  drift: 3,
  prepare(colors: SkinColors, dpr: number): SkinCache {
    return {
      world: gummy(colors.world, dpr),
      aims: gummy(colors.aims, dpr),
      feelings: gummy(colors.feelings, dpr),
    };
  },
  background({ ctx, width, height }) {
    ctx.clearRect(0, 0, width, height);
  },
  edge({ ctx, colors }, a, b, { active, strength }) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(colors.line);
    ctx.globalAlpha = active ? 1 : 0.4 + 0.4 * strength;
    ctx.lineWidth = active ? 3 : 2;
    // Dotted strings: zero-length dashes with round caps draw as beads.
    ctx.setLineDash(active ? [] : [0.1, 5.5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  },
  node({ ctx, now, reducedMotion }, star, { x, y }, { dimmed }, cache) {
    const sprite = cache[star.family];
    if (!sprite) return;
    const d = star.r * 4.2 + 9;
    const wob = reducedMotion ? 0 : Math.sin(now * 0.0017 + star.phase * 4) * 0.045;
    const w = d * (1 + wob);
    const h = d * (1 - wob);
    ctx.globalAlpha = dimmed ? 0.5 : 1;
    // The sprite's body sits slightly above its centre: anchor on the base so the squash reads as weight.
    ctx.drawImage(sprite, x - w / 2, y - h / 2 - (h - d) * 0.4, w, h);
    ctx.globalAlpha = 1;
  },
  ring({ ctx, colors }, star, { x, y }) {
    const r = (star.r * 4.2 + 9) / 2 + 3;
    ctx.strokeStyle = rgba(colors.ring);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  },
  label: {
    font: (f) => `600 13px ${f.fonts.heading}`,
    color: (f) => f.colors.label,
    gap: 18,
  },
};
