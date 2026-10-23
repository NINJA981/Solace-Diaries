/**
 * Motion for overlays and steps (motion/react), in the current world's style. Lazy chunks only:
 * the entry keeps just MotionConfig (provider.ts).
 *
 *   <Motion>…</Motion>    LazyMotion: loads the DOM animation features on first use
 *   useWorldMotion()      { presets, spring, snappy, fade, reduced } for components
 *   enterFrom(presets, reduced, distance?)   the initial/exit pose for an entrance
 *
 * Components use `m.*` (not `motion.*`) so the animation code stays out of the entry chunk.
 */
import { LazyMotion, useReducedMotion } from 'motion/react';
import { createElement, useMemo, type ReactNode } from 'react';
import { useWorldManifest } from '@/worlds';
import type { MotionPresets } from '@/worlds/types';
import type { SpringPreset } from './spring';

const loadFeatures = () => import('./features').then((m) => m.default);

/** Wrap anything that renders `m.*` components. Nested wrappers share one feature load. */
export function Motion({ children }: { children: ReactNode }) {
  return createElement(LazyMotion, { features: loadFeatures }, children);
}

export function spring(preset: SpringPreset) {
  return { type: 'spring' as const, ...preset };
}

/** The entrance pose: a little lower and smaller (world presets), or just transparent when reduced. */
export function enterFrom(presets: MotionPresets, reduced: boolean, distance = presets.enterDistance) {
  return reduced ? { opacity: 0 } : { opacity: 0, y: distance, scale: presets.enterScale };
}

export function useWorldMotion() {
  const { motion } = useWorldManifest();
  const reduced = useReducedMotion() ?? false;
  return useMemo(
    () => ({
      presets: motion,
      spring: spring(motion.spring),
      snappy: spring(motion.snappy),
      /** A quick crossfade, the reduced-motion stand-in for any movement. */
      fade: { duration: 0.15, ease: 'easeOut' as const },
      reduced,
    }),
    [motion, reduced],
  );
}
