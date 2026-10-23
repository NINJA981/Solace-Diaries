import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import type { CompanionProps } from '@/worlds/types';
import './scrapbook-cat.css';

export type CatState = 'idle' | 'saved' | 'celebrate';

const TAIL = 'M82 104C114 108 118 70 100 58C95 55 91 61 96 65C106 74 102 92 80 93Z';

/**
 * Patch's body: a die-cut sticker cat (white cut border, soft paper shadow). Pure markup with
 * token colours (--cat, --cat-ink set in the Scrapbook tokens); motion is CSS transforms and
 * opacity only, and none of it plays under prefers-reduced-motion.
 */
export function CatBody({ state = 'idle', className }: { state?: CatState; className?: string }) {
  const id = useId();
  const happy = state !== 'idle';
  return (
    <svg viewBox="0 0 130 124" className={clsx('cat', className)} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <g id={`${id}-sil`}>
          <path d="M31 42L33 11L57 28ZM89 42L87 11L63 28Z" />
          <ellipse cx="60" cy="53" rx="32" ry="28" />
          <ellipse cx="60" cy="94" rx="29" ry="25" />
        </g>
      </defs>

      <g className="cat-confetti">
        <rect x="8" y="26" width="7" height="3.5" rx="1" transform="rotate(-30 8 26)" fill="var(--accent)" />
        <rect x="112" y="22" width="7" height="3.5" rx="1" transform="rotate(25 112 22)" fill="var(--ai)" />
        <circle cx="120" cy="48" r="3" fill="var(--tape-a)" />
        <circle cx="10" cy="62" r="2.6" fill="var(--tape-b)" />
        <rect x="100" y="6" width="6" height="3" rx="1" transform="rotate(-50 100 6)" fill="var(--accent)" />
      </g>

      <g className="cat-sticker">
        <ellipse cx="62" cy="119" rx="38" ry="3.2" className="cat-shadow" />
        <g className="cat-tail">
          <path d={TAIL} className="cat-cut" />
          <path d={TAIL} className="cat-fur" />
        </g>
        <use href={`#${id}-sil`} className="cat-cut" />
        <use href={`#${id}-sil`} className="cat-fur" />
        <path d="M37 38l1-18 13 10Z M83 38l-1-18-13 10Z" className="cat-ear" />
        <ellipse cx="60" cy="101" rx="16" ry="16" className="cat-belly" />
        <path d="M54 30v8M60 28v10M66 30v8" className="cat-stripes" />
        <g className="cat-face">
          {happy ? (
            <g className="cat-eyes-happy">
              <path d="M42 55q7-9 14 0" />
              <path d="M64 55q7-9 14 0" />
            </g>
          ) : (
            <g className="cat-eyes">
              <ellipse cx="49" cy="54" rx="3.6" ry="5" className="cat-ink" />
              <ellipse cx="71" cy="54" rx="3.6" ry="5" className="cat-ink" />
            </g>
          )}
          <path d="M57 62h6l-3 3.4Z" className="cat-nose" />
          <path d="M60 65.4q-3.4 5-8 2.4M60 65.4q3.4 5 8 2.4" className="cat-mouth" />
          <path d="M30 60l-12-2M30 66l-12 3M90 60l12-2M90 66l12 3" className="cat-whiskers" />
        </g>
        <ellipse cx="46" cy="116" rx="8" ry="5" className="cat-paw" />
        <ellipse cx="74" cy="116" rx="8" ry="5" className="cat-paw" />
        <g transform="translate(100 16) scale(1.3)">
          <path d="M0 6C-9 -1 -8 -9 -3 -9C-1 -9 0 -7 0 -6C0 -7 1 -9 3 -9C8 -9 9 -1 0 6Z" className="cat-heart" />
        </g>
      </g>
    </svg>
  );
}

const SIZE: Record<CompanionProps['placement'], number> = { today: 72, onboarding: 120, settings: 56 };

/**
 * Patch, Scrapbook's companion: a sticker cat that sits on the page, wags its tail and blinks,
 * stamps a little heart when something is saved and throws confetti when you celebrate.
 * Decorative (aria-hidden); the name and mood are available to screen readers as text.
 */
export default function ScrapbookCompanion({ name, placement, state = 'idle' }: CompanionProps & { state?: CatState }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const label = name.trim() || 'Patch';

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const size = SIZE[placement];
  return (
    <span ref={rootRef} className="cat-companion" data-visible={visible} style={{ width: size, height: size * (124 / 130) }}>
      <CatBody state={state} />
      <span className="sr-only">
        {label}, your companion{state === 'saved' ? ' stamped a heart on your page' : state === 'celebrate' ? ' is celebrating' : ''}.
      </span>
    </span>
  );
}
