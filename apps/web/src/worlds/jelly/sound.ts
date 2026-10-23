import type { SoundPack } from '../types';

/**
 * Jelly's sounds: boops. Everything glides upward (a happy, rising contour), uses sine and
 * triangle only, and decays fast so it never lingers. A cue is a main boop plus a quieter
 * octave "bloop" riding on it, which is what makes it feel gummy rather than beepy.
 */
const sound: SoundPack = {
  // The signature: a rising boop with a bright little tail.
  save: {
    tones: [
      { wave: 'sine', freq: 280, to: 640, attack: 0.006, decay: 0.16, gain: 0.085 },
      { wave: 'sine', freq: 560, to: 1280, attack: 0.006, decay: 0.12, gain: 0.03 },
      { wave: 'triangle', freq: 1318.5, at: 0.1, attack: 0.004, decay: 0.14, gain: 0.035 },
    ],
  },
  open: {
    tones: [
      { wave: 'sine', freq: 520, to: 780, attack: 0.004, decay: 0.09, gain: 0.06 },
      { wave: 'sine', freq: 1040, to: 1560, attack: 0.004, decay: 0.06, gain: 0.02 },
    ],
  },
  // A pentatonic scramble upward: C6 E6 G6 C7.
  celebrate: {
    tones: [
      { wave: 'triangle', freq: 1046.5, to: 1108, attack: 0.004, decay: 0.14, gain: 0.05 },
      { wave: 'triangle', freq: 1318.5, to: 1396.9, at: 0.07, attack: 0.004, decay: 0.14, gain: 0.05 },
      { wave: 'triangle', freq: 1568, to: 1661, at: 0.14, attack: 0.004, decay: 0.16, gain: 0.05 },
      { wave: 'sine', freq: 2093, to: 2217, at: 0.21, attack: 0.004, decay: 0.34, gain: 0.05 },
      { wave: 'sine', freq: 523.3, to: 698, attack: 0.006, decay: 0.3, gain: 0.04 },
    ],
  },
  // A soft, wobbly deflate rather than a buzz.
  error: {
    tones: [
      { wave: 'sine', freq: 330, to: 170, attack: 0.008, decay: 0.26, gain: 0.07 },
      { wave: 'sine', freq: 165, to: 120, at: 0.05, attack: 0.008, decay: 0.2, gain: 0.04 },
    ],
  },
  tap: { tones: [{ wave: 'sine', freq: 720, to: 1050, attack: 0.002, decay: 0.04, gain: 0.04 }] },
};
export default sound;
