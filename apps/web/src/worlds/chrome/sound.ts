import type { SoundPack } from '../types';

/** Chrome (provisional): soft synth clicks and tickers, bright and brief. */
const sound: SoundPack = {
  save: {
    tones: [
      { wave: 'sine', freq: 1760, attack: 0.002, decay: 0.08, gain: 0.04 },
      { wave: 'sine', freq: 2637, at: 0.045, attack: 0.002, decay: 0.1, gain: 0.03 },
    ],
  },
  open: { tones: [{ wave: 'triangle', freq: 880, to: 1320, attack: 0.002, decay: 0.07, gain: 0.04 }] },
  celebrate: {
    tones: [1318.51, 1567.98, 1975.53, 2637.02].map((freq, i) => ({
      wave: 'sine' as const,
      freq,
      at: i * 0.045,
      attack: 0.002,
      decay: 0.09,
      gain: 0.035,
    })),
  },
  error: {
    tones: [
      { wave: 'triangle', freq: 440, attack: 0.002, decay: 0.07, gain: 0.05 },
      { wave: 'triangle', freq: 370, at: 0.09, attack: 0.002, decay: 0.09, gain: 0.05 },
    ],
  },
  tap: { tones: [{ wave: 'sine', freq: 2400, attack: 0.001, decay: 0.02, gain: 0.025 }] },
};
export default sound;
