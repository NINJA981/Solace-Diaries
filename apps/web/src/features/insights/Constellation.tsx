import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Graph, GraphKind } from '@solace/shared';
import { rgba, isLightColor } from '@/lib/color';
import { readToken, resolveColors } from '@/lib/color-dom';
import { starsSkin } from '@/worlds/lamplight/constellationSkin';
import { FAMILIES, layoutConstellation, type Star } from './constellationLayout';
import type { ConstellationSkin, SkinCache, SkinColors, SkinFrame } from './skin';

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

const FALLBACK: Omit<SkinColors, 'light'> = {
  world: { r: 227, g: 182, b: 94, a: 1 },
  aims: { r: 169, g: 156, b: 240, a: 1 },
  feelings: { r: 235, g: 232, b: 243, a: 1 },
  line: { r: 70, g: 82, b: 122, a: 1 },
  label: { r: 179, g: 175, b: 198, a: 1 },
  ring: { r: 240, g: 203, b: 126, a: 1 },
  background: { r: 15, g: 21, b: 36, a: 1 },
};

/** The skin's colours as the browser resolves them here (any CSS colour, any world or theme). */
function readColors(scope: Element, skin: ConstellationSkin): SkinColors {
  const resolved = resolveColors(
    {
      world: skin.familyTokens.world,
      aims: skin.familyTokens.aims,
      feelings: skin.familyTokens.feelings,
      line: '--line-strong',
      label: '--fg-muted',
      ring: '--focus',
      background: '--sunken',
    },
    scope,
  );
  const pick = (k: keyof typeof FALLBACK) => resolved[k] ?? FALLBACK[k];
  const background = pick('background');
  return {
    world: pick('world'),
    aims: pick('aims'),
    feelings: pick('feelings'),
    line: pick('line'),
    label: pick('label'),
    ring: pick('ring'),
    background,
    light: isLightColor(background),
  };
}

function readFonts(scope: Element): SkinFrame['fonts'] {
  return {
    ui: readToken('--font-ui', scope) || 'system-ui, sans-serif',
    heading: readToken('--font-heading', scope) || 'serif',
  };
}

/**
 * The Memory Constellation: what Solace remembers, drawn by the current world's skin (stars in
 * Lamplight). Layout is computed once; afterwards nodes only drift a couple of pixels. The loop
 * runs at ~30fps and only while the canvas is on screen, the tab is visible and motion is
 * allowed. Colours are re-read whenever the world or theme changes.
 */
export const Constellation = memo(function Constellation({ graph, skin = starsSkin }: { graph: Graph; skin?: ConstellationSkin }) {
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
    let colors = readColors(wrap, skin);
    let fonts = readFonts(wrap);
    let cache: SkinCache = {};
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let raf = 0;
    let last = 0;
    let now = performance.now();
    const maxLink = Math.max(1, ...links.map((l) => l.w));

    const prepare = () => {
      cache = skin.prepare?.(colors, dpr) ?? {};
    };

    const pos = (i: number) => {
      const s = stars[i]!;
      const drift = reduce.matches ? 0 : skin.drift;
      return {
        x: MARGIN + s.x * (w - MARGIN * 2) + Math.sin(now * 0.00023 + s.phase) * drift,
        y: MARGIN + s.y * (h - MARGIN * 2) + Math.cos(now * 0.00019 + s.phase * 1.3) * drift,
      };
    };
    posRef.current = pos;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const frame: SkinFrame = { ctx, width: w, height: h, dpr, colors, now, reducedMotion: reduce.matches, fonts };
      skin.background(frame);
      const act = activeRef.current;
      const p = stars.map((_, i) => pos(i));
      for (const l of links) {
        skin.edge(frame, p[l.a]!, p[l.b]!, { active: act !== null && (l.a === act || l.b === act), strength: l.w / maxLink });
      }
      stars.forEach((s, i) => {
        skin.node(frame, s, p[i]!, { active: act === i, dimmed: act !== null && act !== i }, cache);
      });
      if (act !== null && stars[act]) skin.ring(frame, stars[act]!, p[act]!);
      // Selective direct labels: the brightest few nodes, never the active one (it has a tooltip).
      ctx.globalAlpha = 1;
      ctx.font = skin.label.font(frame);
      ctx.fillStyle = rgba(skin.label.color(frame));
      ctx.textBaseline = 'middle';
      for (const i of labelled) {
        if (i === act) continue;
        const { x, y } = p[i]!;
        const s = stars[i]!;
        const right = x < w - 120;
        ctx.textAlign = right ? 'left' : 'right';
        ctx.fillText(s.name, right ? x + s.r + skin.label.gap : x - s.r - skin.label.gap, y);
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
      prepare();
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
    // World and theme switches change the token values: re-read them and re-render the sprites.
    // Watch the root and the nearest previewed world (a [data-world] subtree), if any.
    const retheme = () => {
      colors = readColors(wrap, skin);
      fonts = readFonts(wrap);
      prepare();
      draw();
    };
    const mo = new MutationObserver(retheme);
    const watched = ['data-world', 'data-theme', 'class', 'style'];
    mo.observe(document.documentElement, { attributes: true, attributeFilter: watched });
    const scope = wrap.closest('[data-world]');
    if (scope && scope !== document.documentElement) mo.observe(scope, { attributes: true, attributeFilter: watched });
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
  }, [stars, links, labelled, skin]);

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
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-control border border-line-strong bg-raised px-2.5 py-1.5 text-xs whitespace-nowrap shadow-1"
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
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: `var(${skin.familyTokens[f.key]})` }} />
            {f.label}
          </span>
        ))}
        <span className="text-fg-faint">Bigger stars come up more often. Lines join things that appear together.</span>
      </div>
    </div>
  );
});

export type { Star };
