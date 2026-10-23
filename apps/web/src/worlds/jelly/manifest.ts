import themeColors from '../theme-colors.json';
import { lazy } from 'react';
import type { WorldManifest } from '../types';

/**
 * The Jelly world. Tokens ship in the main stylesheet; everything else is lazy: the fonts,
 * the landing hero and the companion are code-split (and only fetched when this world is in
 * use), and the constellation skin, sound and voice load on demand.
 */
const Hero = lazy(() => import('@/features/landing/heroes/JellyHero'));
const Companion = lazy(() => import('@/components/companions/JellyPip'));

export const jelly: WorldManifest = {
  id: 'jelly',
  name: 'Jelly',
  description: 'Gummy colour, soft corners and a little bounce. Fun to come back to.',
  themeColor: themeColors.jelly,
  loadFonts: () => import('./fonts.css'),
  motion: {
    spring: { stiffness: 420, damping: 18, mass: 1 },
    snappy: { stiffness: 500, damping: 22, mass: 1 },
    enterDistance: 14,
    enterScale: 0.92,
  },
  loadSound: () => import('./sound').then((m) => m.default),
  haptics: { save: [10, 24, 16], open: 8, celebrate: [12, 36, 12, 36, 12, 36, 24], error: [28, 36, 28], tap: 6 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero,
  loadConstellationSkin: () => import('@/features/insights/skins/jellySkin').then((m) => m.jellySkin),
  Companion,
  companionName: 'Pip',
};
