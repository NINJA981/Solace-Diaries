import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buzz, feedback, internals, play, resetFeedbackForTests, setFeedbackPrefs } from '.';
import { resetAppearanceForTests } from '@/lib/theme';
import { worlds } from '@/worlds';

const playSpec = vi.fn();
const warm = vi.fn();
let clock = 0;

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? on : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  resetFeedbackForTests();
  resetAppearanceForTests();
  localStorage.clear();
  playSpec.mockClear();
  clock += 10_000;
  vi.spyOn(internals, 'loadSynth').mockResolvedValue({ playSpec, warm } as never);
  vi.spyOn(internals, 'now').mockImplementation(() => clock);
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
  reducedMotion(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const gesture = () => window.dispatchEvent(new Event('pointerdown'));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('feedback gating', () => {
  it('is silent and still by default (public pages, people who never opted in)', async () => {
    gesture();
    feedback('save');
    await flush();
    expect(internals.loadSynth).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('waits for a user gesture before making any sound', async () => {
    setFeedbackPrefs({ sound: true, haptics: false });
    play('save');
    await flush();
    expect(playSpec).not.toHaveBeenCalled();
    gesture();
    play('save');
    const pack = await worlds.lamplight.loadSound();
    await vi.waitFor(() => expect(playSpec).toHaveBeenCalledWith(pack.save));
  });

  it('plays the current world’s pack', async () => {
    setFeedbackPrefs({ sound: true, haptics: false });
    gesture();
    localStorage.setItem('solace.world', 'chrome');
    resetAppearanceForTests();
    play('error');
    const pack = await worlds.chrome.loadSound();
    await vi.waitFor(() => expect(playSpec).toHaveBeenCalledWith(pack.error));
  });

  it('never repeats the same cue faster than every 120ms', async () => {
    setFeedbackPrefs({ sound: true, haptics: false });
    gesture();
    play('tap');
    play('tap');
    await flush();
    expect(playSpec).toHaveBeenCalledTimes(1);
  });

  it('buzzes with the world’s pattern only when haptics are on', () => {
    buzz('celebrate');
    expect(navigator.vibrate).not.toHaveBeenCalled();
    setFeedbackPrefs({ sound: false, haptics: true });
    buzz('celebrate');
    expect(navigator.vibrate).toHaveBeenCalledWith(worlds.lamplight.haptics.celebrate);
  });

  it('keeps haptics still when reduced motion is preferred', () => {
    reducedMotion(true);
    setFeedbackPrefs({ sound: false, haptics: true });
    buzz('save');
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('copes with devices that can’t vibrate', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
    setFeedbackPrefs({ sound: false, haptics: true });
    expect(() => buzz('tap')).not.toThrow();
  });
});
