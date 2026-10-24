import type { SoundPack } from '../types';

/**
 * Chrome: crisp, short, bright. A filtered noise tick for the "click", then a clean high partial.
 * Everything is under 150ms and quiet; the world's identity is the precision, not the volume.
 */
const sound: SoundPack = {
  // A solid, confirming double click: low tick, then a bright resolve a fifth up.
  save: {
    noise: { duration: 0.012, gain: 0.05, filter: 5200, q: 2 },
    tones: [
      { wave: 'triangle', freq: 1320, to: 1180, attack: 0.001, decay: 0.05, gain: 0.05 },
      { wave: 'sine', freq: 1976, at: 0.05, attack: 0.001, decay: 0.09, gain: 0.04 },
    ],
  },
  // A light upward sweep, like a latch releasing.
  open: {
    noise: { duration: 0.008, gain: 0.03, filter: 6400, q: 3 },
    tones: [{ wave: 'triangle', freq: 880, to: 1480, attack: 0.001, decay: 0.07, gain: 0.04 }],
  },
  // Four quick rising pings, tight spacing, like a counter locking in.
  celebrate: {
    noise: { duration: 0.01, gain: 0.04, filter: 7000, q: 2 },
    tones: [1318.51, 1760, 2349.32, 3135.96].map((freq, i) => ({
      wave: 'sine' as const,
      freq,
      at: i * 0.05,
      attack: 0.001,
      decay: 0.11,
      gain: 0.035,
    })),
  },
  // Two flat, short buzzes: no alarm, just "not that".
  error: {
    tones: [
      { wave: 'square', freq: 311, attack: 0.001, decay: 0.05, gain: 0.025 },
      { wave: 'square', freq: 247, at: 0.075, attack: 0.001, decay: 0.07, gain: 0.025 },
    ],
  },
  // The smallest click that still registers.
  tap: {
    noise: { duration: 0.006, gain: 0.035, filter: 4800, q: 2.5 },
    tones: [{ wave: 'sine', freq: 2600, attack: 0.001, decay: 0.018, gain: 0.02 }],
  },
};
export default sound;
