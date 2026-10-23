import type { SoundPack } from '../types';

/** Scrapbook (provisional): paper rustles, tape snaps and soft wooden taps. */
const sound: SoundPack = {
  save: {
    tones: [{ wave: 'sine', freq: 160, attack: 0.004, decay: 0.12, gain: 0.06 }],
    noise: { duration: 0.18, gain: 0.05, filter: 2500, q: 0.7 },
  },
  open: { tones: [], noise: { duration: 0.26, gain: 0.04, filter: 3500, q: 0.5 } },
  celebrate: {
    tones: [
      { wave: 'sine', freq: 784, at: 0.06, attack: 0.003, decay: 0.25, gain: 0.05 },
      { wave: 'sine', freq: 1046.5, at: 0.14, attack: 0.003, decay: 0.35, gain: 0.045 },
    ],
    noise: { duration: 0.05, gain: 0.06, filter: 4200, q: 1.2 },
  },
  error: {
    tones: [{ wave: 'sine', freq: 140, attack: 0.004, decay: 0.2, gain: 0.07 }],
    noise: { duration: 0.08, gain: 0.04, filter: 400, q: 0.9 },
  },
  tap: { tones: [], noise: { duration: 0.02, gain: 0.05, filter: 6000, q: 1 } },
};
export default sound;
