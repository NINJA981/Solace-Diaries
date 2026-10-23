import type { SoundPack } from '../types';

/** Jelly (provisional): pops and bloops, pitched up, quick to decay. */
const sound: SoundPack = {
  save: {
    tones: [
      { wave: 'sine', freq: 330, to: 660, attack: 0.005, decay: 0.12, gain: 0.08 },
      { wave: 'sine', freq: 880, at: 0.07, attack: 0.004, decay: 0.1, gain: 0.04 },
    ],
  },
  open: { tones: [{ wave: 'sine', freq: 600, to: 900, attack: 0.004, decay: 0.09, gain: 0.06 }] },
  celebrate: {
    tones: [
      { wave: 'triangle', freq: 1046.5, to: 1174.66, attack: 0.004, decay: 0.16, gain: 0.05 },
      { wave: 'triangle', freq: 1318.51, to: 1396.91, at: 0.08, attack: 0.004, decay: 0.16, gain: 0.05 },
      { wave: 'triangle', freq: 1567.98, to: 1760, at: 0.16, attack: 0.004, decay: 0.3, gain: 0.05 },
    ],
  },
  error: { tones: [{ wave: 'triangle', freq: 320, to: 150, attack: 0.006, decay: 0.28, gain: 0.07 }] },
  tap: { tones: [{ wave: 'sine', freq: 800, to: 1200, attack: 0.002, decay: 0.04, gain: 0.04 }] },
};
export default sound;
