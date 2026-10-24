import { clsx } from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LamplightSky } from '@/features/landing/heroes/lamplightSky';
import './hero.css';

/**
 * The landing's one memorable moment: a journal entry written by lamplight, where a few
 * words are "remembered". Each lifts off its line as a star, settles into the night above,
 * and Solace joins them into a small constellation. Plays once when it first comes into
 * view; with reduced motion it renders the finished composition. Cheap: positioned
 * elements + Web Animations, no canvas loop; the ambient twinkle pauses off screen.
 */

type StarId = 'maya' | 'lake' | 'run' | 'dad' | 'visit';
type Star = {
  id: StarId;
  label: string;
  /** Target position in the sky, % of the sky box. */
  x: number;
  y: number;
  /** Core diameter in px. */
  size: number;
  labelAt: 'above' | 'below' | 'left';
};

// Irregular on purpose: an afternoon (Maya, the lake, a first run) forms a small triangle;
// the call with Dad and the plan to visit trail off it.
const STARS: Star[] = [
  { id: 'maya', label: 'Maya', x: 9, y: 70, size: 8, labelAt: 'below' },
  { id: 'lake', label: 'the lake', x: 25, y: 30, size: 10, labelAt: 'above' },
  { id: 'run', label: 'running again', x: 45, y: 62, size: 7, labelAt: 'below' },
  { id: 'dad', label: 'Dad', x: 67, y: 24, size: 9, labelAt: 'above' },
  { id: 'visit', label: 'visit before winter', x: 90, y: 50, size: 6, labelAt: 'below' },
];
const EDGES: [StarId, StarId][] = [
  ['lake', 'maya'],
  ['maya', 'run'],
  ['lake', 'run'],
  ['run', 'dad'],
  ['dad', 'visit'],
];
const MOON_AT = { x: 0.93, y: 0.14 };
const ORDER: StarId[] = ['lake', 'maya', 'run', 'dad', 'visit']; // reading order in the entry

// Faint background stars: deterministic so every render (and screenshot) matches.
const DUST = (() => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 38 }, () => ({ x: rand() * 100, y: rand() * 100, r: 0.45 + rand() * 0.85, o: 0.16 + rand() * 0.38 }));
})();

const TIMING = {
  lightWord: 250, // first word lights
  lightStep: 140,
  lift: 800, // first star leaves its word
  liftStep: 190,
  flight: 1550,
  lines: 2650,
  lineStep: 190,
  line: 560,
  labels: 2750,
  labelStep: 120,
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Phase = 'idle' | 'playing' | 'done';
type Size = { w: number; h: number };

function byId(id: StarId): Star {
  return STARS.find((s) => s.id === id)!;
}

/** A line between two stars, pulled back from each so it never touches the light. */
function edgeCoords(a: Star, b: Star, sky: Size) {
  const ax = (a.x / 100) * sky.w;
  const ay = (a.y / 100) * sky.h;
  const bx = (b.x / 100) * sky.w;
  const by = (b.y / 100) * sky.h;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const ga = a.size / 2 + 6;
  const gb = b.size / 2 + 6;
  return { x1: ax + ux * ga, y1: ay + uy * ga, x2: bx - ux * gb, y2: by - uy * gb };
}

export function RememberingScene({ className }: { className?: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const words = useRef(new Map<StarId, HTMLElement>());
  const stars = useRef(new Map<StarId, HTMLElement>());
  const rings = useRef(new Map<StarId, HTMLElement>());
  const labels = useRef(new Map<StarId, HTMLElement>());
  const lines = useRef(new Map<string, SVGLineElement>());
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? 'done' : 'idle'));
  const [lit, setLit] = useState<ReadonlySet<StarId>>(() => new Set(phase === 'done' ? ORDER : []));
  const [visible, setVisible] = useState(false);
  const [sky, setSky] = useState<Size | null>(null);

  // Track the sky's pixel size so constellation lines stay crisp at any width.
  useEffect(() => {
    const el = skyRef.current;
    if (!el) return;
    const measure = () => setSky({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start once on screen; also drives pausing the ambient twinkle when off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Begin the moment the scene is on screen and measured (derived during render).
  if (phase === 'idle' && visible && sky) setPhase('playing');

  // Layout effect: stars must be parked on their words before the first painted frame.
  useLayoutEffect(() => {
    if (phase !== 'playing') return;
    const timers: number[] = [];
    const anims: Animation[] = [];
    // Even pacing so the lift-off from the word reads, then a soft landing.
    const settle = 'cubic-bezier(.4,.1,.2,1)';

    ORDER.forEach((id, i) => {
      timers.push(window.setTimeout(() => setLit((prev) => new Set(prev).add(id)), TIMING.lightWord + i * TIMING.lightStep));
      const word = words.current.get(id);
      const star = stars.current.get(id);
      const ring = rings.current.get(id);
      if (!word || !star) return;
      const w = word.getBoundingClientRect();
      const s = star.getBoundingClientRect();
      const dx = w.left + w.width / 2 - (s.left + s.width / 2);
      const dy = w.top + w.height * 0.35 - (s.top + s.height / 2);
      const swing = (i % 2 ? 1 : -1) * Math.min(36, Math.abs(dy) * 0.16);
      const delay = TIMING.lift + i * TIMING.liftStep;
      anims.push(
        star.animate(
          [
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 10}px)) scale(.55)`, opacity: 1, offset: 0.14 },
            { transform: `translate(calc(-50% + ${dx * 0.45 + swing}px), calc(-50% + ${dy * 0.4}px)) scale(.85)`, opacity: 1, offset: 0.58 },
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          ],
          { duration: TIMING.flight, delay, easing: settle, fill: 'both' },
        ),
      );
      if (ring) {
        anims.push(
          ring.animate(
            [
              { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
              { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.55, offset: 0.15 },
              { transform: 'translate(-50%, -50%) scale(3.2)', opacity: 0 },
            ],
            { duration: 900, delay: delay + TIMING.flight * 0.82, easing: 'ease-out', fill: 'both' },
          ),
        );
      }
    });

    EDGES.forEach(([a, b], i) => {
      const line = lines.current.get(`${a}-${b}`);
      if (!line) return;
      anims.push(
        line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: TIMING.line,
          delay: TIMING.lines + i * TIMING.lineStep,
          easing: 'cubic-bezier(.45,0,.25,1)',
          fill: 'both',
        }),
      );
    });

    ORDER.forEach((id, i) => {
      const label = labels.current.get(id);
      if (!label) return;
      anims.push(
        label.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0)' }], {
          duration: 700,
          delay: TIMING.labels + i * TIMING.labelStep,
          easing: 'ease-out',
          fill: 'both',
        }),
      );
    });

    let cancelled = false;
    void Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (!cancelled) setPhase('done');
      },
      () => {},
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [phase]);

  const shown = phase !== 'idle';

  const word = (id: StarId, children: ReactNode) => (
    <span
      ref={(el) => {
        if (el) words.current.set(id, el);
      }}
      // A lamp hairline with a soft glow under the phrase, drawn in as its star lights.
      className={clsx('passage-mark', lit.has(id) && 'is-lit')}
    >
      {children}
    </span>
  );

  return (
    <figure ref={rootRef} data-phase={phase} data-visible={visible} className={clsx('remembering relative isolate', className)}>
      {/* One deliberate light source: the lamp over the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-12 top-[30%] -bottom-20 -z-10 bg-[radial-gradient(52%_48%_at_42%_62%,var(--accent-soft),transparent_72%)]"
      />

      <div ref={skyRef} aria-hidden="true" className="relative h-[180px] sm:h-[230px] lg:h-[250px]">
        <LamplightSky density={0.9} moonAt={MOON_AT} />
        <svg className="absolute inset-0 size-full" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
          {DUST.map((d, i) => (
            <circle
              key={i}
              cx={d.x * 4}
              cy={d.y * 1.6}
              r={d.r}
              fill="var(--fg-faint)"
              opacity={d.o}
              className={i % 4 === 0 ? 'dust-twinkle' : undefined}
              style={i % 4 === 0 ? { animationDelay: `${(i * 0.53) % 4.8}s` } : undefined}
            />
          ))}
        </svg>
        {sky && (
          <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${sky.w} ${sky.h}`}>
            {EDGES.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                ref={(el) => {
                  if (el) lines.current.set(`${a}-${b}`, el);
                }}
                {...edgeCoords(byId(a), byId(b), sky)}
                pathLength={1}
                strokeDasharray="1"
                strokeDashoffset={phase === 'done' ? 0 : 1}
                stroke="var(--ai)"
                strokeOpacity="0.7"
                strokeWidth="1"
                strokeLinecap="round"
              />
            ))}
          </svg>
        )}
        {STARS.map((s) => (
          <span key={s.id} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
            <span
              ref={(el) => {
                if (el) rings.current.set(s.id, el);
              }}
              className="absolute block rounded-full border border-accent opacity-0"
              style={{ width: s.size * 2.4, height: s.size * 2.4, transform: 'translate(-50%, -50%)' }}
            />
            <span
              ref={(el) => {
                if (el) stars.current.set(s.id, el);
              }}
              className={clsx('star absolute block rounded-full bg-accent', !shown && 'opacity-0')}
              style={{
                width: s.size,
                height: s.size,
                transform: 'translate(-50%, -50%)',
                boxShadow: `0 0 ${s.size * 1.4}px ${s.size * 0.35}px var(--accent-glow)`,
              }}
            />
            <span
              ref={(el) => {
                if (el) labels.current.set(s.id, el);
              }}
              className={clsx(
                'absolute font-prose text-label whitespace-nowrap text-ai italic',
                !shown && 'opacity-0',
                s.labelAt === 'above' && 'bottom-3 left-0',
                s.labelAt === 'below' && 'top-3 left-0',
                s.labelAt === 'left' && 'top-0 right-3 -translate-y-1/2',
                s.labelAt !== 'left' && (s.x > 80 ? '-translate-x-[85%]' : '-translate-x-1/2'),
              )}
            >
              {s.label}
            </span>
          </span>
        ))}
      </div>

      <div className="relative mt-5 sm:mt-7">
        <p className="font-prose text-meta text-fg-faint italic">14 October</p>
        <blockquote className="mt-2 font-prose text-prose leading-reading text-fg-muted sm:text-prose-lg">
          <p>
            Walked down to {word('lake', 'the lake')} with {word('maya', 'Maya')} after work. First {word('run', 'run')}{' '}
            since March, and my knee held up the whole way. {word('dad', 'Dad')} called while I was cooling down. I keep
            saying I’ll {word('visit', 'visit him before winter')}.
          </p>
        </blockquote>
      </div>
      <figcaption className="sr-only">
        An example journal entry. Solace notices Maya, the lake, running again, Dad and a plan to visit him before
        winter, and connects them as memories.
      </figcaption>
    </figure>
  );
}
