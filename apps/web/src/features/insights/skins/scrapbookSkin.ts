/**
 * Scrapbook's Memory Constellation: paper luggage tags stuck on an album page. Each memory is
 * a small tag (punched hole, tinted paper in its family colour, a strip of tape on the bigger
 * ones), tilted by hand, sized by weight and joined by stitched pencil lines. Labels are
 * written in the world's handwriting face. The page never moves, so this skin is static in
 * every motion setting; tags are pre-rendered sprites (one per family and tape), not redrawn.
 */
import { mixOklab, rgba, type RGBA } from '@/lib/color';
import type { ConstellationSkin, SkinCache, SkinColors } from '@/features/insights/skin';

const WHITE: RGBA = { r: 255, g: 252, b: 244, a: 1 };
const INK: RGBA = { r: 38, g: 30, b: 22, a: 1 };
const W = 40;
const H = 56;

/** A tag with clipped top corners; `taped` adds a diagonal strip of washi across the top. */
function tag(color: RGBA, dpr: number, taped: boolean): HTMLCanvasElement | undefined {
  const sw = Math.ceil(W * dpr);
  const sh = Math.ceil(H * dpr);
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.scale(dpr, dpr);
  const body = () => {
    g.beginPath();
    g.moveTo(10, 4);
    g.lineTo(30, 4);
    g.lineTo(36, 11);
    g.lineTo(36, 51);
    g.lineTo(4, 51);
    g.lineTo(4, 11);
    g.closePath();
  };
  // Paper shadow, then the paper itself: family colour thinned out with cream.
  g.save();
  g.translate(1.5, 2.2);
  body();
  g.fillStyle = rgba(INK, 0.2);
  g.fill();
  g.restore();
  body();
  g.fillStyle = rgba(mixOklab(color, WHITE, 0.3));
  g.fill();
  g.lineWidth = 1.4;
  g.strokeStyle = rgba(mixOklab(color, INK, 0.6), 0.9);
  g.stroke();
  // Ruled hint of writing space.
  g.strokeStyle = rgba(mixOklab(color, INK, 0.55), 0.35);
  g.lineWidth = 1;
  for (const y of [33, 39, 45]) {
    g.beginPath();
    g.moveTo(10, y);
    g.lineTo(30, y);
    g.stroke();
  }
  // Punched hole with a reinforcement ring.
  g.beginPath();
  g.arc(20, 14, 4.6, 0, Math.PI * 2);
  g.fillStyle = rgba(WHITE, 0.9);
  g.fill();
  g.beginPath();
  g.arc(20, 14, 2.6, 0, Math.PI * 2);
  g.fillStyle = rgba(INK, 0.55);
  g.fill();
  if (taped) {
    g.save();
    g.translate(20, 5);
    g.rotate(-0.28);
    g.fillStyle = rgba(color, 0.42);
    g.fillRect(-13, -4, 26, 8);
    g.strokeStyle = rgba(WHITE, 0.55);
    g.lineWidth = 1;
    g.setLineDash([2, 2]);
    g.strokeRect(-13, -4, 26, 8);
    g.restore();
  }
  return c;
}

const FAMILIES = ['world', 'aims', 'feelings'] as const;

export const scrapbookSkin: ConstellationSkin = {
  id: 'tags',
  familyTokens: { world: '--accent', aims: '--ai', feelings: '--mood-4' },
  drift: 0,
  prepare(colors: SkinColors, dpr: number): SkinCache {
    const cache: SkinCache = {};
    for (const f of FAMILIES) {
      cache[f] = tag(colors[f], dpr, false);
      cache[`${f}:tape`] = tag(colors[f], dpr, true);
    }
    return cache;
  },
  background({ ctx, width, height }) {
    ctx.clearRect(0, 0, width, height);
  },
  edge({ ctx, colors }, a, b, { active, strength }) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(colors.line);
    ctx.globalAlpha = active ? 1 : 0.35 + 0.35 * strength;
    ctx.lineWidth = active ? 2 : 1.2;
    ctx.setLineDash(active ? [] : [5, 4]); // stitched
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  },
  node({ ctx }, star, { x, y }, { dimmed }, cache) {
    const big = star.r > 5;
    const sprite = cache[big ? `${star.family}:tape` : star.family];
    if (!sprite) return;
    const h = star.r * 3.4 + 12;
    const w = h * (W / H);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(star.phase * 7.3) * 0.22); // hand-placed
    ctx.globalAlpha = dimmed ? 0.5 : 1;
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  ring({ ctx, colors }, star, { x, y }) {
    const r = (star.r * 3.4 + 12) / 2 + 4;
    ctx.strokeStyle = rgba(colors.ring);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  label: {
    font: (f) => `500 13px ${f.fonts.heading}`,
    color: (f) => f.colors.label,
    gap: 16,
  },
};
