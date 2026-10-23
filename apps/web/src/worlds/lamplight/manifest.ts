import themeColors from '../theme-colors.json';
import { NoCompanion } from '../NoCompanion';
import type { WorldManifest } from '../types';
import { RememberingScene } from './RememberingScene';

/** The default world. Its fonts, hero and skin ship with the app, so nothing here waits on a chunk. */
export const lamplight: WorldManifest = {
  id: 'lamplight',
  name: 'Lamplight',
  description: 'Ink and a brass lamp. Quiet pages, and memories that surface as stars.',
  themeColor: themeColors.lamplight,
  // Newsreader and Instrument Sans are in the main stylesheet (preloaded for first paint).
  loadFonts: () => Promise.resolve(),
  motion: {
    spring: { stiffness: 120, damping: 22, mass: 1 },
    snappy: { stiffness: 300, damping: 32, mass: 1 },
    enterDistance: 6,
    enterScale: 0.985,
  },
  loadSound: () => import('./sound').then((m) => m.default),
  haptics: { save: 10, open: 6, celebrate: [10, 60, 14], error: [24, 40, 24], tap: 5 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero: RememberingScene,
  loadConstellationSkin: () => import('./constellationSkin').then((m) => m.starsSkin),
  Companion: NoCompanion,
  companionName: 'Firefly',
};
