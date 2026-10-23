import themeColors from '../theme-colors.json';
import { lazy } from 'react';
import type { WorldManifest } from '../types';

/**
 * The Scrapbook world. Tokens ship in the main stylesheet; everything else is lazy: the fonts,
 * the landing hero and the companion are code-split (and only fetched when this world is in
 * use), and the constellation skin, sound and voice load on demand.
 */
const Hero = lazy(() => import('@/features/landing/heroes/ScrapbookHero'));
const Companion = lazy(() => import('@/components/companions/ScrapbookCat'));

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
  haptics: { save: [14, 18, 6], open: [5, 24, 5], celebrate: [10, 50, 10, 50, 18], error: [24, 60, 24], tap: 5 },
  loadVoice: () => import('./voice').then((m) => m.default),
  Hero,
  loadConstellationSkin: () => import('@/features/insights/skins/scrapbookSkin').then((m) => m.scrapbookSkin),
  Companion,
  companionName: 'Patch',
};
