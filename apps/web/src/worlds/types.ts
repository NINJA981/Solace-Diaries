/**
 * The world contract. A world is a whole look (type, colour, shape, density, elevation, motion,
 * texture, sound, haptics, illustration and voice) in light and dark. Every world ships the
 * same anatomy: worlds change tokens and art, never where things are.
 *
 * A world is two files plus optional art:
 *   worlds/<id>/tokens.css   every token for [data-world='<id>'][data-theme='light'|'dark']
 *   worlds/<id>/manifest.ts  this object (cheap to import: anything heavy is a lazy loader)
 */
import type { World } from '@solace/shared';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ConstellationSkin } from '@/features/insights/skin';
import type { SpringPreset } from '@/lib/motion/spring';
import type { VoicePack } from '@/lib/voice';

export type WorldId = World;
export type ThemeName = 'light' | 'dark';

/** The moments the feedback system knows (sounds and haptics). */
export type FeedbackCue = 'save' | 'open' | 'celebrate' | 'error' | 'tap';

/** One synthesised partial: an oscillator with an attack/decay envelope, optionally gliding. */
export type Tone = {
  wave: OscillatorType;
  /** Start frequency in Hz; `to` glides there over the tone. */
  freq: number;
  to?: number;
  /** Seconds after the cue starts. */
  at?: number;
  attack: number;
  decay: number;
  /** Peak gain, 0..1, before the master volume. */
  gain: number;
  detune?: number;
};

/** A short UI sound built from tones and an optional filtered noise burst (paper, tape, air). */
export type SoundSpec = {
  tones: Tone[];
  noise?: { at?: number; duration: number; gain: number; /** Band-pass centre in Hz. */ filter: number; q?: number };
};
export type SoundPack = Record<FeedbackCue, SoundSpec>;

/** navigator.vibrate patterns (ms). Keep them short; they play only when the person opted in. */
export type HapticPack = Record<FeedbackCue, number | number[]>;

export type MotionPresets = {
  /** Default spring for dialogs, sheets and step changes (motion/react). Mirrors --ease-spring. */
  spring: SpringPreset;
  /** A quicker spring for small things: toasts, chips, menus. */
  snappy: SpringPreset;
  /** How far (px) things travel as they enter. Reduced motion always uses 0. */
  enterDistance: number;
  /** Scale things start from as they enter (1 = no scale). */
  enterScale: number;
};

export type HeroProps = { className?: string };
export type CompanionProps = {
  /** The person's name for the companion; empty means the world's default name. */
  name: string;
  /** Where it appears, so it can size itself. */
  placement: 'today' | 'onboarding' | 'settings';
  /** A brief reaction: just saved an entry, or a milestone to celebrate. Defaults to idle. */
  state?: 'idle' | 'saved' | 'celebrate';
};

export type WorldManifest = {
  id: WorldId;
  /** Shown in the world picker. */
  name: string;
  /** One line for the world picker. */
  description: string;
  /** Browser UI colour per theme: must equal the world's --canvas (theme-colors.json, checked in tests). */
  themeColor: Record<ThemeName, string>;
  /** Registers the world's @font-face rules (lazily: fonts download only when the world is used). */
  loadFonts: () => Promise<unknown>;
  motion: MotionPresets;
  /** Synth parameters for each cue; loaded on the first sound after a user gesture. */
  loadSound: () => Promise<SoundPack>;
  haptics: HapticPack;
  /** Moment copy in the world's voice. Missing keys fall back to the base strings. */
  loadVoice: () => Promise<Partial<VoicePack>>;
  /** The landing hero. Keep the default world's static; other worlds should use React.lazy. */
  Hero: ComponentType<HeroProps> | LazyExoticComponent<ComponentType<HeroProps>>;
  /** How the Memory Constellation draws (stars, gummies, stickers, orbs…). */
  loadConstellationSkin: () => Promise<ConstellationSkin>;
  /** The world's companion. Renders nothing until a world gives it one. */
  Companion: ComponentType<CompanionProps> | LazyExoticComponent<ComponentType<CompanionProps>>;
  /** Default companion name (shown when the person hasn't named it). */
  companionName: string;
};
