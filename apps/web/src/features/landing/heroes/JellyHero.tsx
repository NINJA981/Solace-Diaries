import { clsx } from 'clsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { PipBody, type PipState } from '@/components/companions/JellyPip';
import type { HeroProps } from '@/worlds/types';
import './jelly-hero.css';

/**
 * Jelly's landing hero: Pip drops in, a few remembered things pop up around it like gumdrops,
 * and the "Make my journal" button is Pip's favourite thing in the world. Pip looks at the
 * pointer, leans in when the button (or the page's own "Start your journal" link) is hovered
 * or focused, squashes flat when it is pressed and hops when it lands.
 *
 * Cheap on purpose: SVG + CSS transforms only, no images, one rAF-throttled pointer handler,
 * and every ambient loop pauses while the hero is off screen. With reduced motion it renders
 * the finished, still composition.
 */

type Mood = 'idle' | 'eager' | 'press';

const BUBBLES: { label: string; tone: 'accent' | 'ai' | 'violet' | 'pop'; style: CSSProperties }[] = [
  { label: 'Maya', tone: 'ai', style: { left: '6%', top: '12%', ['--i' as string]: 0 } },
  { label: 'the lake', tone: 'violet', style: { right: '6%', top: '8%', ['--i' as string]: 1 } },
  { label: 'first run', tone: 'accent', style: { left: '4%', top: '34%', ['--i' as string]: 2 } },
  { label: 'Dad called', tone: 'pop', style: { right: '5%', top: '30%', ['--i' as string]: 3 } },
];

export default function JellyHero({ className }: HeroProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [played, setPlayed] = useState(false);
  const [mood, setMood] = useState<Mood>('idle');
  const [hop, setHop] = useState(false);

  // Play the entrance once, when the hero first comes into view; pause ambient loops off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const on = Boolean(entry?.isIntersecting);
        setVisible(on);
        if (on) setPlayed(true);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Pip's eyes follow the pointer (one write per frame, to two CSS variables).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
    let raf = 0;
    let nx = 0;
    let ny = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty('--gaze-x', nx.toFixed(2));
      el.style.setProperty('--gaze-y', ny.toFixed(2));
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.4)) / (r.height / 2)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The page's own call to action is Pip's friend too.
  useEffect(() => {
    const target = (e: Event) => (e.target as Element | null)?.closest?.('a[href="/signup"]');
    const inside = (el: Element) => rootRef.current?.contains(el);
    const on = (e: Event) => {
      const a = target(e);
      if (a && !inside(a)) setMood('eager');
    };
    const off = (e: Event) => {
      const a = target(e);
      if (a && !inside(a)) setMood('idle');
    };
    document.addEventListener('pointerover', on);
    document.addEventListener('pointerout', off);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => {
      document.removeEventListener('pointerover', on);
      document.removeEventListener('pointerout', off);
      document.removeEventListener('focusin', on);
      document.removeEventListener('focusout', off);
    };
  }, []);

  useEffect(() => {
    if (!hop) return;
    const t = window.setTimeout(() => setHop(false), 900);
    return () => window.clearTimeout(t);
  }, [hop]);

  const pip: PipState = hop ? 'saved' : 'idle';

  return (
    <figure
      ref={rootRef}
      data-visible={visible}
      data-played={played}
      data-mood={mood}
      className={clsx('jelly-hero relative isolate', className)}
    >
      <div className="jh-stage">
        <ul aria-hidden="true" className="jh-bubbles">
          {BUBBLES.map((b) => (
            <li key={b.label} className="jh-bubble" data-tone={b.tone} style={b.style}>
              <span>{b.label}</span>
            </li>
          ))}
        </ul>

        <div className="jh-pip" aria-hidden="true">
          <div className="jh-pose">
            <PipBody state={pip} />
          </div>
        </div>

        <p className="jh-say">
          <span>what tiny thing made you grin today?</span>
        </p>

        <Link
          to="/signup"
          className="jh-button"
          onPointerEnter={() => setMood('eager')}
          onPointerLeave={() => setMood('idle')}
          onFocus={() => setMood('eager')}
          onBlur={() => setMood('idle')}
          onPointerDown={() => setMood('press')}
          onPointerUp={() => setMood('eager')}
          onClick={() => setHop(true)}
        >
          Make my journal
        </Link>
      </div>
      <figcaption className="sr-only">
        Pip, a friendly jelly blob, and a few things your journal could remember: Maya, the lake, a first run since
        March, and a call from Dad.
      </figcaption>
    </figure>
  );
}
