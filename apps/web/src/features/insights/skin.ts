/**
 * How the Memory Constellation is drawn. The renderer (Constellation.tsx) owns layout, the
 * frame loop, hit-testing, accessibility and the colour pipeline; a skin only paints. Each
 * world names its skin in its manifest (stars for Lamplight; gummies, stickers, orbs later).
 *
 * Colours arrive resolved (any CSS colour the world uses: hex, oklch, color-mix…), re-read
 * whenever the world or theme changes, including on a previewed [data-world] subtree.
 */
import type { RGBA } from '@/lib/color';
import type { Family, Star } from './constellationLayout';

export type Point = { x: number; y: number };

export type SkinColors = Record<Family, RGBA> & {
  /** Links between nodes. */
  line: RGBA;
  /** Direct labels on the brightest nodes. */
  label: RGBA;
  /** The hover/focus ring. */
  ring: RGBA;
  /** The fill behind the sky (the canvas sits on --sunken). */
  background: RGBA;
  /** True when the background reads as paper rather than ink. */
  light: boolean;
};

/** Everything a skin may need to paint one frame. Coordinates are CSS pixels (DPR is applied). */
export type SkinFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  colors: SkinColors;
  /** Milliseconds; frozen when motion is reduced. */
  now: number;
  reducedMotion: boolean;
  /** Families of the page's type roles, for labels drawn in the world's UI face. */
  fonts: { ui: string; heading: string };
};

export type NodeState = {
  /** Hovered or keyboard-focused. */
  active: boolean;
  /** Something else is active. */
  dimmed: boolean;
};

export type EdgeState = {
  /** Touches the active node. */
  active: boolean;
  /** Link strength relative to the strongest link, 0..1. */
  strength: number;
};

/** Expensive per-colour pre-renders (glow sprites, textures), rebuilt on colour or DPR change. */
export type SkinCache = Record<string, CanvasImageSource | undefined>;

export type ConstellationSkin = {
  id: string;
  /** Which token colours each node family; the legend under the canvas shows these. */
  familyTokens: Record<Family, string>;
  /** Pre-renders (e.g. one glow sprite per family): drawing sprites beats shadowBlur. */
  prepare?: (colors: SkinColors, dpr: number) => SkinCache;
  /** Paints behind everything. Leave transparent to show the card's --sunken fill. */
  background: (f: SkinFrame) => void;
  edge: (f: SkinFrame, a: Point, b: Point, state: EdgeState) => void;
  node: (f: SkinFrame, star: Star, at: Point, state: NodeState, cache: SkinCache) => void;
  /** The ring around the active node. */
  ring: (f: SkinFrame, star: Star, at: Point) => void;
  /** Direct labels for the brightest few nodes. */
  label: { font: (f: SkinFrame) => string; color: (f: SkinFrame) => RGBA; gap: number };
  /** Ambient drift in px (0 = still). The renderer only animates when this is > 0 and motion is on. */
  drift: number;
};
