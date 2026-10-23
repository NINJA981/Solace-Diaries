import themeColors from '../theme-colors.json';
import { RememberingScene } from '../lamplight/RememberingScene';
import { NoCompanion } from '../NoCompanion';
import type { WorldManifest } from '../types';

/**
 * SKELETON world: its own palette, type, motion, sounds and haptics; the hero, constellation
 * skin and companion are still Lamplight's (or nothing) until the Jelly world pass lands.
 */
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
  haptics: { save: [12, 30, 18], open: 10, celebrate: [14, 40, 14, 40, 22], error: [30, 40, 30], tap: 8 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero: RememberingScene,
  loadConstellationSkin: () => import('../lamplight/constellationSkin').then((m) => m.starsSkin),
  Companion: NoCompanion,
  companionName: 'Blob',
};
