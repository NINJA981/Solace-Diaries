import themeColors from '../theme-colors.json';
import { RememberingScene } from '../lamplight/RememberingScene';
import { NoCompanion } from '../NoCompanion';
import type { WorldManifest } from '../types';

/**
 * SKELETON world: its own palette, type, motion, sounds and haptics; the hero, constellation
 * skin and companion are still Lamplight's (or nothing) until the Chrome world pass lands.
 */
export const chrome: WorldManifest = {
  id: 'chrome',
  name: 'Chrome',
  description: 'Graphite, ice and a holographic sheen. Precise, quick and data-forward.',
  themeColor: themeColors.chrome,
  loadFonts: () => import('./fonts.css'),
  motion: {
    spring: { stiffness: 700, damping: 50, mass: 1 },
    snappy: { stiffness: 900, damping: 60, mass: 1 },
    enterDistance: 8,
    enterScale: 0.98,
  },
  loadSound: () => import('./sound').then((m) => m.default),
  haptics: { save: 8, open: 5, celebrate: [6, 30, 6, 30, 6], error: [16, 30, 16], tap: 4 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero: RememberingScene,
  loadConstellationSkin: () => import('../lamplight/constellationSkin').then((m) => m.starsSkin),
  Companion: NoCompanion,
  companionName: 'Orb',
};
