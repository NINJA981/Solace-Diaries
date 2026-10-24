import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { isLightColor } from '@/lib/color';
import { resolveColors } from '@/lib/color-dom';
import { paintSky, type SkyColors, type SkyOptions } from '@/lib/sky/paint';

/**
 * Lamplight's live sky: stars that follow the local evening and tonight's real moon, on a small
 * canvas. Decoration only (aria-hidden), absolutely positioned: place it in a relatively
 * positioned box, behind or beside content. It never changes the page palette or text contrast.
 *
 * Cheap: DPR-aware (capped at 2), paused while off screen or while the tab is hidden, and a
 * single still frame under reduced motion (redrawn only on resize, theme change or the next
 * quarter hour, so the moon and the light still track the evening).
 */

type Props = {
  className?: string;
  /** Overrides "now" (tests, screenshots, previews). */
  date?: Date;
  moon?: boolean;
  density?: number;
  moonAt?: SkyOptions['moonAt'];
  moonRadius?: number;
};

const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function readColors(canvas: HTMLCanvasElement): SkyColors | null {
  const t = resolveColors({ fg: '--fg', faint: '--fg-faint', accent: '--accent', canvas: '--canvas' }, canvas);
  if (!t.fg || !t.faint || !t.accent || !t.canvas) return null;
  const light = isLightColor(t.canvas);
  return {
    star: t.fg,
    // Pale moon on ink, brass moon on paper.
    moon: light ? t.accent : t.fg,
    limb: t.faint,
    glow: t.accent,
    light,
  };
}

export function LamplightSky({ className, date, moon = true, density = 1, moonAt, moonRadius }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let colors = readColors(canvas);
    let visible = false;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    const reduced = prefersReduced();

    const draw = (now: number) => {
      if (!colors || !width || !height) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSky(ctx, width, height, colors, { date: date ?? new Date(), now: reduced ? 0 : now, moon, density, moonAt, moonRadius });
    };
    const loop = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (reduced) return draw(0);
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      draw(performance.now());
      kick();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
      if (visible) kick();
    });
    io.observe(canvas);
    const onVisibility = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Re-read colours when the world or theme changes.
    const mo = new MutationObserver(() => {
      colors = readColors(canvas);
      draw(performance.now());
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-world', 'data-theme', 'class'] });
    // The evening moves on: refresh the still frame every quarter hour.
    const tick = reduced ? window.setInterval(() => draw(0), 15 * 60 * 1000) : 0;

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      if (tick) clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [date, moon, density, moonAt, moonRadius]);

  return <canvas ref={ref} aria-hidden="true" data-sky className={clsx('pointer-events-none absolute inset-0 size-full', className)} />;
}
