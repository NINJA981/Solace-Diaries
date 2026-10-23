/**
 * UI sounds and haptics, in the current world's style.
 *
 *   play('save' | 'open' | 'celebrate' | 'error' | 'tap')   a short synthesised sound (WebAudio)
 *   buzz(cue)                                                 a vibration pattern (Android)
 *   feedback(cue)                                             both
 *
 * Everything is OFF unless the person turned it on (profile.soundEnabled / hapticsEnabled,
 * pushed here by useProfileAppearanceSync): public pages never make a sound. Sounds need a
 * user gesture first (the AudioContext is created lazily, on or after one); haptics also stay
 * still when the person prefers reduced motion. The synth and the world's sound pack load on
 * the first sound, so none of this weighs on the first paint.
 */
import { readWorld } from '@/lib/theme';
import { worldOf } from '@/worlds';
import type { FeedbackCue } from '@/worlds/types';

export type { FeedbackCue };
export type FeedbackPrefs = { sound: boolean; haptics: boolean };

let prefs: FeedbackPrefs = { sound: false, haptics: false };
let gestured = false;

export function setFeedbackPrefs(next: FeedbackPrefs): void {
  prefs = { sound: !!next.sound, haptics: !!next.haptics };
}
export function getFeedbackPrefs(): FeedbackPrefs {
  return prefs;
}

/** Seams for tests. */
export const internals = {
  loadSynth: () => import('./synth'),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

function hasGesture(): boolean {
  if (gestured) return true;
  const activation = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined;
  return !!activation?.hasBeenActive;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Remember the first gesture (and warm the audio up on it if sound is on), once.
function armGesture(): void {
  if (typeof window === 'undefined') return;
  const onGesture = () => {
    gestured = true;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    if (prefs.sound) void internals.loadSynth().then((s) => s.warm());
  };
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, true);
}
armGesture();

const lastPlayed = new Map<FeedbackCue, number>();

/** Plays a cue in the current world's sound pack. No-op unless sound is on and a gesture happened. */
export function play(cue: FeedbackCue): void {
  if (!prefs.sound || !hasGesture()) return;
  // Never machine-gun: the same cue at most every 120ms.
  const t = internals.now();
  if (t - (lastPlayed.get(cue) ?? -Infinity) < 120) return;
  lastPlayed.set(cue, t);
  const manifest = worldOf(readWorld());
  void Promise.all([internals.loadSynth(), manifest.loadSound()])
    .then(([synth, pack]) => synth.playSpec(pack[cue]))
    .catch(() => {
      /* no audio on this device: silence is fine */
    });
}

/** Vibrates with the current world's pattern for a cue. No-op unless haptics are on. */
export function buzz(cue: FeedbackCue): void {
  if (!prefs.haptics || prefersReducedMotion()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(worldOf(readWorld()).haptics[cue]);
  } catch {
    /* blocked (no user activation yet, or a policy): fine */
  }
}

export function feedback(cue: FeedbackCue): void {
  play(cue);
  buzz(cue);
}

/** Test helper. */
export function resetFeedbackForTests(): void {
  prefs = { sound: false, haptics: false };
  gestured = false;
  lastPlayed.clear();
  armGesture();
}
