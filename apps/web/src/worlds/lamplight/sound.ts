import type { SoundPack } from '../types';

/** Lamplight: soft sine bells, warm and low. A save is a faint bloom of ink. */
const sound: SoundPack = {
  save: {
    tones: [
      { wave: 'sine', freq: 523.25, attack: 0.012, decay: 0.55, gain: 0.07 },
      { wave: 'sine', freq: 783.99, at: 0.05, attack: 0.02, decay: 0.6, gain: 0.035 },
    ],
  },
  open: {
    tones: [{ wave: 'sine', freq: 392, to: 523.25, attack: 0.02, decay: 0.25, gain: 0.04 }],
    noise: { duration: 0.12, gain: 0.015, filter: 1800, q: 0.8 },
  },
  celebrate: {
    tones: [
      { wave: 'sine', freq: 523.25, attack: 0.01, decay: 0.7, gain: 0.05 },
      { wave: 'sine', freq: 659.25, at: 0.09, attack: 0.01, decay: 0.7, gain: 0.05 },
      { wave: 'sine', freq: 783.99, at: 0.18, attack: 0.01, decay: 0.75, gain: 0.05 },
      { wave: 'sine', freq: 1046.5, at: 0.27, attack: 0.01, decay: 0.9, gain: 0.04 },
    ],
  },
  error: {
    tones: [
      { wave: 'triangle', freq: 233.08, attack: 0.01, decay: 0.22, gain: 0.06 },
      { wave: 'triangle', freq: 196, at: 0.13, attack: 0.01, decay: 0.3, gain: 0.06 },
    ],
  },
  tap: { tones: [{ wave: 'sine', freq: 1046.5, attack: 0.003, decay: 0.05, gain: 0.03 }] },
};
export default sound;
