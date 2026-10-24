/**
 * Paints Lamplight's sky onto a canvas: faint stars that brighten as the local evening deepens, a
 * horizon warmth at dawn and dusk, and tonight's moon in its true phase. It is decoration laid
 * over the page background, so it only ever adds light or ink at low alpha and never sits under
 * body text (callers place it behind or beside content).
 *
 * Cheap on purpose: a few dozen arcs, one radial gradient for the moon's halo, no shadowBlur,
 * no per-frame allocation beyond the gradient. Deterministic star positions (seeded), so a given
 * size and date always paint the same frame.
 */
import { rgba, type RGBA } from '@/lib/color';
import { daylight, type Daylight } from './daylight';
import { litPath, moonPhase, type MoonPhase } from './moon';

export type SkyColors = {
  /** Star colour (a quiet foreground). */
  star: RGBA;
  /** The lit moon. */
  moon: RGBA;
  /** The dark limb and earthshine tint. */
  limb: RGBA;
  /** Horizon warmth at dawn and dusk. */
  glow: RGBA;
  /** True on paper (light theme): stars are drawn as ink, so they need more alpha. */
  light: boolean;
};

export type SkyOptions = {
  date: Date;
  /** Milliseconds, for twinkle. Pass a constant for a still frame. */
  now: number;
  /** Draw the moon (the Insights header and the hero both do). */
  moon?: boolean;
  /** Scales the star count (1 = hero density). */
  density?: number;
  /** Moon centre as a fraction of the box. */
  moonAt?: { x: number; y: number };
  /** Moon radius in CSS px (default scales with the box). */
  moonRadius?: number;
};

type Dust = { x: number; y: number; r: number; base: number; phase: number; speed: number };

const dustCache = new Map<number, Dust[]>();
/** Seeded star field in unit coordinates: stable across renders, sizes and sessions. */
function starField(count: number): Dust[] {
  const cached = dustCache.get(count);
  if (cached) return cached;
  let seed = 424242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const field = Array.from({ length: count }, () => ({
    x: rand(),
    y: rand() * rand() ** 0.5, // a little denser toward the top
    r: 0.6 + rand() ** 3 * 1.2,
    base: 0.55 + rand() * 0.45,
    phase: rand() * Math.PI * 2,
    speed: 0.4 + rand() * 0.9,
  }));
  dustCache.set(count, field);
  return field;
}

export type SkyState = { daylight: Daylight; moon: MoonPhase };
export function skyState(date: Date): SkyState {
  return { daylight: daylight(date), moon: moonPhase(date) };
}

export function paintSky(ctx: CanvasRenderingContext2D, width: number, height: number, colors: SkyColors, opts: SkyOptions): SkyState {
  const state = skyState(opts.date);
  const { night, glow } = state.daylight;
  ctx.clearRect(0, 0, width, height);

  // Horizon warmth: a low wash that peaks at dawn and dusk.
  if (glow > 0.02) {
    const g = ctx.createLinearGradient(0, height, 0, height * 0.25);
    g.addColorStop(0, rgba(colors.glow, 0.2 * glow));
    g.addColorStop(1, rgba(colors.glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // Stars: by day they are barely there, by night they carry the sky.
  const count = Math.round(Math.min(90, (width * height) / 4200) * (opts.density ?? 1));
  const reach = colors.light ? 1.1 : 1.1;
  const brightness = 0.1 + 0.9 * night;
  for (const s of starField(Math.max(8, count))) {
    const twinkle = 0.78 + 0.22 * Math.sin(opts.now * 0.001 * s.speed + s.phase);
    ctx.globalAlpha = Math.min(0.95, s.base * brightness * twinkle * reach);
    ctx.fillStyle = rgba(colors.star, 1);
    ctx.beginPath();
    ctx.arc(s.x * width, s.y * height * 0.92 + 2, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (opts.moon !== false) paintMoon(ctx, width, height, colors, opts, state);
  return state;
}

function paintMoon(ctx: CanvasRenderingContext2D, width: number, height: number, colors: SkyColors, opts: SkyOptions, state: SkyState) {
  const r = opts.moonRadius ?? Math.max(9, Math.min(20, height * 0.075));
  const at = opts.moonAt ?? { x: 0.92, y: 0.17 };
  const cx = Math.min(width - r - 4, Math.max(r + 4, at.x * width));
  const cy = Math.min(height - r - 4, Math.max(r + 4, at.y * height));
  // The moon is visible all day (it often is) but quieter in daylight.
  const presence = 0.4 + 0.6 * state.daylight.night;
  const m = state.moon;

  ctx.save();
  ctx.globalAlpha = presence;
  // Halo scales with illumination: a full moon throws light, a sliver barely any.
  if (!colors.light) {
    const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 4.2);
    halo.addColorStop(0, rgba(colors.moon, 0.16 * m.illuminated + 0.02));
    halo.addColorStop(1, rgba(colors.moon, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 4.2, cy - r * 4.2, r * 8.4, r * 8.4);
  }
  // Dark limb (earthshine).
  ctx.fillStyle = rgba(colors.limb, 0.2);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Lit part.
  const d = litPath(m, cx, cy, r);
  if (d) {
    ctx.fillStyle = rgba(colors.moon, 0.95);
    ctx.fill(new Path2D(d));
  }
  // Hairline so the dark side still reads as a disc.
  ctx.strokeStyle = rgba(colors.limb, 0.5);
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
