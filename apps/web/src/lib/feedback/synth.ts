/**
 * The WebAudio synth behind play(): oscillators with attack/decay envelopes plus an optional
 * band-passed noise burst, through one master gain. No audio files. Loaded on the first sound.
 */
import type { SoundSpec } from '@/worlds/types';

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

const MASTER_VOLUME = 0.6;
const FLOOR = 0.0001;

function context(): AudioContext | null {
  if (!ctx) {
    const Ctor: AudioCtor | undefined =
      typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Creates or resumes the AudioContext; call from (or after) a user gesture. */
export function warm(): void {
  context();
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const length = Math.floor(c.sampleRate * 0.5);
  noiseBuffer = c.createBuffer(1, length, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // Deterministic noise (same grain every time) from a tiny LCG.
  let seed = 1234567;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return noiseBuffer;
}

export function playSpec(spec: SoundSpec): void {
  const c = context();
  if (!c || !master) return;
  const t0 = c.currentTime + 0.005;
  for (const tone of spec.tones) {
    const start = t0 + (tone.at ?? 0);
    const end = start + tone.attack + tone.decay;
    const osc = c.createOscillator();
    osc.type = tone.wave;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, end);
    if (tone.detune) osc.detune.setValueAtTime(tone.detune, start);
    const gain = c.createGain();
    gain.gain.setValueAtTime(FLOOR, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(FLOOR, tone.gain), start + tone.attack);
    gain.gain.exponentialRampToValueAtTime(FLOOR, end);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(end + 0.03);
  }
  if (spec.noise) {
    const n = spec.noise;
    const start = t0 + (n.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = n.filter;
    filter.Q.value = n.q ?? 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(FLOOR, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(FLOOR, n.gain), start + Math.min(0.01, n.duration / 4));
    gain.gain.exponentialRampToValueAtTime(FLOOR, start + n.duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(start);
    src.stop(start + n.duration + 0.03);
  }
}
