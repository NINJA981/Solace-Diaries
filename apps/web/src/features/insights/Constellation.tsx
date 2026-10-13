import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Graph, GraphKind } from '@solace/shared';
import { FAMILIES, layoutConstellation, type Family, type Star } from './constellationLayout';

const KIND_LABEL: Record<GraphKind, string> = {
  person: 'Person',
  place: 'Place',
  project: 'Project',
  goal: 'Goal',
  habit: 'Habit',
  emotion: 'Feeling',
};
const MARGIN = 30;
const FRAME_MS = 1000 / 30; // a quiet sky doesn't need 60fps
const LABELLED = 5;

type Colors = Record<Family, string> & { line: string; label: string; ring: string; light: boolean };

/** Rough luminance of a #rrggbb token, to tell a paper (light) sky from an ink (dark) one. */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    world: v('--lamp', '#e3b65e'),
    aims: v('--dusk', '#a99cf0'),
    feelings: v('--fg', '#ebe8f3'),
    line: v('--line-strong', '#46527a'),
    label: v('--fg-muted', '#b3afc6'),
    ring: v('--focus', '#f0cb7e'),
    light: isLight(v('--sunken', '#0f1524')),
  };
}

function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** One soft glow per family, rendered once; drawing sprites is far cheaper than shadowBlur. */
function makeSprite(color: string, dpr: number, strength: number): HTMLCanvasElement {
  const size = Math.ceil(64 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, withAlpha(color, 0.55 * strength));
  grad.addColorStop(0.35, withAlpha(color, 0.16 * strength));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * The Memory Constellation: what Solace remembers, drawn as a night sky. Layout is computed
 * once; afterwards stars only drift a couple of pixels. The loop runs at ~30fps and only while
 * the canvas is on screen, the tab is visible and reduced motion is off.
 */
export const Constellation = memo(function Constellation({ graph }: { graph: Graph }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stars, links } = useMemo(() => layoutConstellation(graph, 2), [graph]);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const activeRef = useRef<number | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const posRef = useRef<(i: number) => { x: number; y: number }>(() => ({ x: 0, y: 0 }));
  const listRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [rovingIndex, setRovingIndex] = useState(0);

  const active = focused ?? hover;
  activeRef.current = active;

  const labelled = useMemo(() => {
    const idx = stars.map((_, i) => i).sort((a, b) => stars[b]!.weight - stars[a]!.weight);
    return new Set(idx.slice(0, LABELLED));
  }, [stars]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let colors = readColors();
    let sprites: Record<Family, HTMLCanvasElement> = {} as Record<Family, HTMLCanvasElement>;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let raf = 0;
    let last = 0;
    let now = performance.now();
    const maxLink = Math.max(1, ...links.map((l) => l.w));

    const buildSprites = () => {
      // Glows read as light on ink; on paper they'd read as smudges, so keep them faint.
      const k = colors.light ? 0.35 : 1;
      sprites = {
        world: makeSprite(colors.world, dpr, k),
        aims: makeSprite(colors.aims, dpr, k),
        feelings: makeSprite(colors.feelings, dpr, colors.light ? 0.15 : 1),
      };
    };

    const pos = (i: number) => {
      const s = stars[i]!;
      const drift = reduce.matches ? 0 : 2.2;
      return {
        x: MARGIN + s.x * (w - MARGIN * 2) + Math.sin(now * 0.00023 + s.phase) * drift,
        y: MARGIN + s.y * (h - MARGIN * 2) + Math.cos(now * 0.00019 + s.phase * 1.3) * drift,
      };
    };
    posRef.current = pos;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const act = activeRef.current;
      const p = stars.map((_, i) => pos(i));
      ctx.lineCap = 'round';
      for (const l of links) {
        const touches = act !== null && (l.a === act || l.b === act);
        ctx.strokeStyle = colors.line;
        ctx.globalAlpha = touches ? 0.85 : 0.18 + 0.32 * (l.w / maxLink);
        ctx.lineWidth = touches ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(p[l.a]!.x, p[l.a]!.y);
        ctx.lineTo(p[l.b]!.x, p[l.b]!.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      stars.forEach((s, i) => {
        const { x, y } = p[i]!;
        const twinkle = reduce.matches ? 1 : 0.82 + 0.18 * Math.sin(now * 0.0011 + s.phase * 3);
        const g = s.r * 7;
        ctx.globalAlpha = twinkle * (act === null || act === i ? 1 : 0.7);
        ctx.drawImage(sprites[s.family], x - g / 2, y - g / 2, g, g);
        ctx.globalAlpha = act === null || act === i ? 1 : 0.75;
        ctx.fillStyle = colors[s.family];
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (act !== null && stars[act]) {
        const { x, y } = p[act]!;
        ctx.strokeStyle = colors.ring;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, stars[act]!.r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Selective direct labels: the brightest few stars, never the active one (it has a tooltip).
      ctx.font = '500 12px "Instrument Sans", system-ui, sans-serif';
      ctx.fillStyle = colors.label;
      ctx.textBaseline = 'middle';
      for (const i of labelled) {
        if (i === act) continue;
        const { x, y } = p[i]!;
        const s = stars[i]!;
        const right = x < w - 120;
        ctx.textAlign = right ? 'left' : 'right';
        ctx.fillText(s.name, right ? x + s.r + 6 : x - s.r - 6, y);
      }
    };
    redrawRef.current = () => {
      now = performance.now();
      draw();
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      now = t;
      draw();
    };
    const start = () => {
      if (!raf && onScreen && pageVisible && !reduce.matches) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = Math.round(Math.max(260, Math.min(440, w * 0.52)));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      buildSprites();
      draw();
    };
    resize();
    start();

    const ro = new ResizeObserver(() => {
      if (wrap.clientWidth !== w) resize();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => {
      pageVisible = document.visibilityState !== 'hidden';
      if (pageVisible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);
    const onMotion = () => {
      stop();
      draw();
      start();
    };
    reduce.addEventListener('change', onMotion);
    // Theme switches change the token values: re-read them and re-render the glows.
    const retheme = () => {
      colors = readColors();
      buildSprites();
      draw();
    };
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const scheme = window.matchMedia('(prefers-color-scheme: light)');
    scheme.addEventListener('change', retheme);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onMotion);
      scheme.removeEventListener('change', retheme);
    };
  }, [stars, links, labelled]);

  // Static skies (reduced motion / paused) still need to show hover and focus.
  useEffect(() => {
    redrawRef.current();
    if (active === null) {
      setTip(null);
      return;
    }
    setTip(posRef.current(active));
  }, [active]);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: number | null = null;
    let bestD = Infinity;
    stars.forEach((s, i) => {
      const p = posRef.current(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(14, s.r + 10) && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    setHover(best);
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? stars.length - 1 : (rovingIndex + delta + stars.length) % stars.length;
    setRovingIndex(next);
    listRefs.current[next]?.focus();
  };

  const a = active !== null ? stars[active] : null;
  return (
    <div>
      <div ref={wrapRef} className="relative overflow-hidden rounded-card border border-line bg-sunken">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          className="block"
        />
        {a && tip && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-control border border-line-strong bg-raised px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--shadow-card)]"
            style={{ left: tip.x, top: tip.y - a.r - 10 }}
          >
            <span className="font-medium text-fg">{a.name}</span>
            <span className="ml-2 text-fg-faint">{KIND_LABEL[a.kind]}</span>
          </div>
        )}
        {/* Keyboard and screen readers: the same stars as a list (one tab stop, arrows move). */}
        <ul aria-label="Things Solace remembers" onKeyDown={onListKey} className="sr-only">
          {stars.map((s, i) => (
            <li key={s.id}>
              <button
                ref={(el) => {
                  listRefs.current[i] = el;
                }}
                type="button"
                tabIndex={i === rovingIndex ? 0 : -1}
                onFocus={() => {
                  setRovingIndex(i);
                  setFocused(i);
                }}
                onBlur={() => setFocused(null)}
              >
                {s.name}, {KIND_LABEL[s.kind].toLowerCase()}
                {links.filter((l) => l.a === i || l.b === i).length
                  ? `, linked to ${links
                      .filter((l) => l.a === i || l.b === i)
                      .slice(0, 3)
                      .map((l) => stars[l.a === i ? l.b : l.a]!.name)
                      .join(', ')}`
                  : ''}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
        {FAMILIES.map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: `var(${f.token})` }} />
            {f.label}
          </span>
        ))}
        <span className="text-fg-faint">Bigger stars come up more often. Lines join things that appear together.</span>
      </div>
    </div>
  );
});

export type { Star };
