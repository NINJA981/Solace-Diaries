/**
 * Entry-chunk motion setup: only MotionConfig (tiny). It makes the world's spring the default
 * transition and turns movement into a crossfade when the person prefers reduced motion. The
 * animation features themselves load with the first component that animates (see `Motion`).
 */
import { MotionConfig } from 'motion/react';
import { createElement, useMemo, type ReactNode } from 'react';
import { useWorldManifest } from '@/worlds';

export function MotionProvider({ children }: { children: ReactNode }) {
  const { motion } = useWorldManifest();
  const transition = useMemo(() => ({ type: 'spring' as const, ...motion.spring }), [motion.spring]);
  return createElement(MotionConfig, { reducedMotion: 'user', transition }, children);
}
