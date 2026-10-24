import { lazy, type ComponentType } from 'react';
import themeColors from '../theme-colors.json';
import type { CompanionProps, HeroProps, WorldManifest } from '../types';

// Heavy art stays out of the entry chunk: the hero and companion are lazy.
const ChromeHero = lazy(() => import('@/features/landing/heroes/chromeHero').then((m) => ({ default: m.ChromeHero as ComponentType<HeroProps> })));
const ChromeCompanion = lazy(() =>
  import('@/components/companions/chromeOrb').then((m) => ({ default: m.ChromeOrb as ComponentType<CompanionProps> })),
);

/**
 * Chrome: graphite, ice and a holographic sheen. Liquid-glass surfaces, a pointer-following
 * highlight, wide display type and mono numerals; fast, exact motion. Its fonts, glass layer and
 * pointer light load together the first time the world is used.
 */
export const chrome: WorldManifest = {
  id: 'chrome',
  name: 'Chrome',
  description: 'Graphite, ice and a holographic sheen. Precise, quick and data-forward.',
  themeColor: themeColors.chrome,
  loadFonts: () =>
    Promise.all([import('./fonts.css'), import('./glass.css'), import('./pointer').then((m) => m.installPointerLight())]),
  motion: {
    spring: { stiffness: 700, damping: 50, mass: 1 },
    snappy: { stiffness: 900, damping: 60, mass: 1 },
    enterDistance: 8,
    enterScale: 0.98,
  },
  loadSound: () => import('./sound').then((m) => m.default),
  haptics: { save: 8, open: 5, celebrate: [6, 30, 6, 30, 6], error: [16, 30, 16], tap: 4 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero: ChromeHero,
  loadConstellationSkin: () => import('@/features/insights/skins/chromeSkin').then((m) => m.chromeSkin),
  Companion: ChromeCompanion,
  companionName: 'Orb',
};
