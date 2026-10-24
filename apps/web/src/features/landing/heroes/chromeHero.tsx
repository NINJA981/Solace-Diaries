import { clsx } from 'clsx';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import './chromeHero.css';

/**
 * Chrome's landing moment: a liquid-glass readout of one journal day. When it first scrolls into
 * view, three phrases in the entry light up, the counters tick up to their values, and the mood
 * line draws itself, once (~1.6s). A specular highlight follows the pointer across the glass on
 * devices with a mouse. Reduced motion renders the finished composition. Everything is CSS plus
 * one rAF counter that only runs while the moment plays.
 */

type Phase = 'idle' | 'playing' | 'done';

const STATS = [
  { id: 'entries', label: 'Entries', value: 214 },
  { id: 'streak', label: 'Day streak', value: 38 },
  { id: 'memories', label: 'Memories', value: 1206 },
] as const;

const MOOD = [2.6, 2.9, 2.4, 3.1, 3.4, 3.2, 3.8, 3.6, 4.1, 4.2];
const LINE = (() => {
  const w = 240;
  const h = 44;
  const pts = MOOD.map((v, i) => [(i / (MOOD.length - 1)) * w, h - ((v - 2) / 2.4) * (h - 6) - 3] as const);
  return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''), last: pts[pts.length - 1]!, w, h };
})();

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const easeOut = (t: number) => 1 - (1 - t) ** 4;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function hasFinePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function ChromeHero({ className }: { className?: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const counters = useRef(new Map<string, HTMLElement>());
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? 'done' : 'idle'));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (phase === 'idle' && visible) setPhase('playing');

  useEffect(() => {
    if (phase !== 'playing') return;
    const start = performance.now() + 350;
    const duration = 1250;
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      for (const s of STATS) {
        const el = counters.current.get(s.id);
        if (el) el.textContent = fmt(s.value * easeOut(t));
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else setPhase('done');
    };
    for (const s of STATS) {
      const el = counters.current.get(s.id);
      if (el) el.textContent = '0';
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !hasFinePointer() || prefersReducedMotion()) return;
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
    card.dataset.lit = 'true';
  };
  const onLeave = () => {
    if (cardRef.current) cardRef.current.dataset.lit = 'false';
  };

  return (
    <figure ref={rootRef} data-phase={phase} data-visible={visible} className={clsx('chrome-hero relative isolate', className)}>
      <div aria-hidden="true" className="chrome-aura" />
      <div
        ref={cardRef}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="chrome-card holo-edge relative overflow-hidden rounded-sheet bg-surface p-5 sm:p-8"
      >
        <div className="flex items-baseline justify-between gap-3 font-mono text-caption text-fg-faint">
          <span>14 Oct 2026</span>
          <span>19:42</span>
        </div>

        <blockquote className="mt-4 text-prose leading-reading text-fg-muted sm:text-prose-lg">
          <p>
            Walked to <span className="chrome-ent" style={{ '--i': 0 } as CSSProperties}>the lake</span> with{' '}
            <span className="chrome-ent" style={{ '--i': 1 } as CSSProperties}>Maya</span> after work. First{' '}
            <span className="chrome-ent" style={{ '--i': 2 } as CSSProperties}>run</span> since March, and my knee held. Dad called
            while I cooled down.
          </p>
        </blockquote>

        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-5">
          {STATS.map((s) => (
            <div key={s.id} className="flex min-w-0 flex-col-reverse justify-end">
              <dd
                ref={(el) => {
                  if (el) counters.current.set(s.id, el);
                }}
                className="font-display text-2xl leading-none text-fg sm:text-3xl"
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '-0.04em' }}
              >
                {fmt(s.value)}
              </dd>
              <dt className="mt-2 text-xs text-fg-muted">{s.label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex items-end justify-between gap-4">
          <svg viewBox={`0 0 ${LINE.w} ${LINE.h}`} className="chrome-mood h-11 min-w-0 flex-1 max-w-[15rem] overflow-visible" aria-hidden="true" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chrome-mood-grad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="var(--mood-1)" />
                <stop offset="0.5" stopColor="var(--mood-2)" />
                <stop offset="1" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <path d={LINE.d} fill="none" stroke="url(#chrome-mood-grad)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="chrome-mood-line" vectorEffect="non-scaling-stroke" />
          </svg>
          <p className="shrink-0 text-right font-mono text-caption text-ai">3 memories linked</p>
        </div>
      </div>
      <figcaption className="sr-only">
        An example journal day. Solace picks out the lake, Maya and a run from the entry, and shows 214 entries, a 38-day streak
        and 1,206 memories, with a mood line trending up.
      </figcaption>
    </figure>
  );
}

export default ChromeHero;
