/**
 * Lamplight's Memory Constellation: what Solace remembers, drawn as a night sky. Stars glow
 * through one pre-rendered sprite per family (far cheaper than shadowBlur), lines are faint
 * until a star is active, and the sky drifts a couple of pixels while motion is allowed.
 */
import { rgba, type RGBA } from '@/lib/color';
import type { ConstellationSkin, SkinCache, SkinColors } from '@/features/insights/skin';

/** One soft radial glow, rendered once per colour and DPR. */
function glowSprite(color: RGBA, dpr: number, strength: number): HTMLCanvasElement | undefined {
  const size = Math.ceil(64 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return undefined;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(color, 0.55 * strength));
  grad.addColorStop(0.35, rgba(color, 0.16 * strength));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export const starsSkin: ConstellationSkin = {
  id: 'stars',
  familyTokens: { world: '--accent', aims: '--ai', feelings: '--fg' },
  drift: 2.2,
  prepare(colors: SkinColors, dpr: number): SkinCache {
    // Glows read as light on ink; on paper they'd read as smudges, so keep them faint.
    const k = colors.light ? 0.35 : 1;
    return {
      world: glowSprite(colors.world, dpr, k),
      aims: glowSprite(colors.aims, dpr, k),
      feelings: glowSprite(colors.feelings, dpr, colors.light ? 0.15 : 1),
    };
  },
  background({ ctx, width, height }) {
    ctx.clearRect(0, 0, width, height);
  },
  edge({ ctx, colors }, a, b, { active, strength }) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(colors.line);
    ctx.globalAlpha = active ? 0.85 : 0.18 + 0.32 * strength;
    ctx.lineWidth = active ? 1.2 : 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  node({ ctx, colors, now, reducedMotion }, star, { x, y }, { dimmed }, cache) {
    const twinkle = reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(now * 0.0011 + star.phase * 3);
    const sprite = cache[star.family];
    if (sprite) {
      const g = star.r * 7;
      ctx.globalAlpha = twinkle * (dimmed ? 0.7 : 1);
      ctx.drawImage(sprite, x - g / 2, y - g / 2, g, g);
    }
    ctx.globalAlpha = dimmed ? 0.75 : 1;
    ctx.fillStyle = rgba(colors[star.family]);
    ctx.beginPath();
    ctx.arc(x, y, star.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  },
  ring({ ctx, colors }, star, { x, y }) {
    ctx.strokeStyle = rgba(colors.ring);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, star.r + 5, 0, Math.PI * 2);
    ctx.stroke();
  },
  label: {
    font: (f) => `500 12px ${f.fonts.ui}`,
    color: (f) => f.colors.label,
    gap: 6,
  },
};
