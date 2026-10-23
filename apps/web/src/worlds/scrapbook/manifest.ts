import themeColors from '../theme-colors.json';
import { RememberingScene } from '../lamplight/RememberingScene';
import { NoCompanion } from '../NoCompanion';
import type { WorldManifest } from '../types';

/**
 * SKELETON world: its own palette, type, motion, sounds and haptics; the hero, constellation
 * skin and companion are still Lamplight's (or nothing) until the Scrapbook world pass lands.
 */
export const scrapbook: WorldManifest = {
  id: 'scrapbook',
  name: 'Scrapbook',
  description: 'Kraft paper, stamps and gel pens. Every entry a page you made by hand.',
  themeColor: themeColors.scrapbook,
  loadFonts: () => import('./fonts.css'),
  motion: {
    spring: { stiffness: 260, damping: 24, mass: 1 },
    snappy: { stiffness: 380, damping: 30, mass: 1 },
    enterDistance: 10,
    enterScale: 0.97,
  },
  loadSound: () => import('./sound').then((m) => m.default),
  haptics: { save: 14, open: [6, 20, 6], celebrate: [12, 50, 12], error: [28, 50, 28], tap: 6 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero: RememberingScene,
  loadConstellationSkin: () => import('../lamplight/constellationSkin').then((m) => m.starsSkin),
  Companion: NoCompanion,
  companionName: 'Patch',
};
