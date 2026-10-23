import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import type { CompanionProps } from '@/worlds/types';
import './jelly-pip.css';

export type PipState = 'idle' | 'saved' | 'celebrate';

/**
 * Pip's body: one glossy blob, drawn in SVG with token colours so it follows the world and
 * theme. Pure markup: all motion is CSS (transform and opacity only), so it costs nothing at
 * rest and is simply not animated under prefers-reduced-motion.
 */
export function PipBody({ state = 'idle', className }: { state?: PipState; className?: string }) {
  const clip = useId();
  const happy = state !== 'idle';
  return (
    <svg viewBox="0 0 120 104" className={clsx('pip', className)} data-state={state} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d="M60 5C93 4 115 27 115 58c0 27-21 40-55 40S5 85 5 58C5 28 27 6 60 5Z" />
        </clipPath>
      </defs>
      <g className="pip-sparkles">
        <path d="M14 22l2.4 5.6 5.6 2.4-5.6 2.4L14 38l-2.4-5.6L6 30l5.6-2.4Z" />
        <path d="M108 14l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8Z" />
        <circle cx="100" cy="46" r="2.6" />
        <circle cx="20" cy="56" r="2.2" />
      </g>
      <g className="pip-squish">
        <ellipse cx="60" cy="100" rx="40" ry="4" className="pip-shadow" />
        <g className="pip-body">
          <path d="M60 5C93 4 115 27 115 58c0 27-21 40-55 40S5 85 5 58C5 28 27 6 60 5Z" className="pip-fill" />
          <g clipPath={`url(#${clip})`}>
            <ellipse cx="68" cy="104" rx="64" ry="34" className="pip-deep" />
            <ellipse cx="38" cy="26" rx="26" ry="13" transform="rotate(-24 38 26)" className="pip-gloss" />
            <circle cx="82" cy="20" r="4.5" className="pip-gloss" />
          </g>
          <g className="pip-face">
            <ellipse cx="36" cy="66" rx="8" ry="5.2" className="pip-cheek" />
            <ellipse cx="84" cy="66" rx="8" ry="5.2" className="pip-cheek" />
            {happy ? (
              <g className="pip-eyes-happy">
                <path d="M39 55q7-10 14 0" />
                <path d="M67 55q7-10 14 0" />
              </g>
            ) : (
              <g className="pip-eyes">
                <ellipse cx="46" cy="53" rx="7" ry="9" className="pip-eye" />
                <ellipse cx="74" cy="53" rx="7" ry="9" className="pip-eye" />
                <g className="pip-pupils">
                  <circle cx="47.5" cy="50" r="2.6" className="pip-shine" />
                  <circle cx="75.5" cy="50" r="2.6" className="pip-shine" />
                </g>
              </g>
            )}
            {happy ? (
              <path d="M51 70q9 11 18 0Z" className="pip-mouth-open" />
            ) : (
              <path d="M54 69q6 5 12 0" className="pip-mouth" />
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}

const SIZE: Record<CompanionProps['placement'], number> = { today: 76, onboarding: 128, settings: 60 };

/**
 * Pip, Jelly's companion: a squishy blob that breathes while idle, hops when something is
 * saved and bounces with sparkles on a celebration. Decorative for sighted people
 * (aria-hidden); the name and mood are available to screen readers as plain text.
 */
export default function JellyCompanion({ name, placement, state = 'idle' }: CompanionProps & { state?: PipState }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const label = name.trim() || 'Pip';

  // Pause the idle breathing while off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const size = SIZE[placement];
  return (
    <span ref={rootRef} className="pip-companion" data-visible={visible} style={{ width: size, height: size * (104 / 120) }}>
      <PipBody state={state} />
      <span className="sr-only">
        {label}, your companion{state === 'saved' ? ' is happy you saved' : state === 'celebrate' ? ' is celebrating' : ''}.
      </span>
    </span>
  );
}
