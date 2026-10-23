import type { SoundPack } from '../types';

/**
 * Scrapbook's sounds are made of paper: band-passed noise for snaps, rustles and tape, and a
 * soft low sine for the thud of something pressed down. Tones are rare and gentle (a felt
 * hammer, not a bell), so the world sounds like a desk rather than an app.
 */
const sound: SoundPack = {
  // The signature: a paper snap (a sharp noise tick) landing on a soft thump.
  save: {
    tones: [{ wave: 'sine', freq: 170, to: 110, attack: 0.003, decay: 0.09, gain: 0.07 }],
    noise: { duration: 0.09, gain: 0.09, filter: 2600, q: 0.9 },
  },
  // A page turning: a longer, softer rustle.
  open: { tones: [], noise: { duration: 0.24, gain: 0.05, filter: 1900, q: 0.45 } },
  // Tape tearing off the roll, then two soft pencil-on-wood taps like a little ding.
  celebrate: {
    tones: [
      { wave: 'sine', freq: 880, at: 0.14, attack: 0.003, decay: 0.28, gain: 0.04 },
      { wave: 'sine', freq: 1318.5, at: 0.22, attack: 0.003, decay: 0.4, gain: 0.035 },
    ],
    noise: { duration: 0.14, gain: 0.07, filter: 5200, q: 1.1 },
  },
  // A dull thud and a muffled scuff.
  error: {
    tones: [{ wave: 'sine', freq: 120, to: 85, attack: 0.004, decay: 0.2, gain: 0.08 }],
    noise: { duration: 0.1, gain: 0.04, filter: 500, q: 0.8 },
  },
  tap: { tones: [], noise: { duration: 0.02, gain: 0.05, filter: 5600, q: 1.6 } },
};
export default sound;
