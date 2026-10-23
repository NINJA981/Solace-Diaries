import { describe, expect, it } from 'vitest';
import { WORLDS } from '@solace/shared';
import { WORLD_IDS } from '@/lib/theme';
import { dampingRatio } from '@/lib/motion/spring';
import { DEFAULT_WORLD, WORLD_ORDER, worldOf, worlds } from '.';
import type { FeedbackCue } from './types';

const CUES: FeedbackCue[] = ['save', 'open', 'celebrate', 'error', 'tap'];

describe('world registry', () => {
  it('has exactly the worlds of the shared contract, in picker order, Lamplight first', () => {
    expect([...WORLD_ORDER].sort()).toEqual([...WORLDS].sort());
    expect(Object.keys(worlds).sort()).toEqual([...WORLDS].sort());
    expect([...WORLD_IDS].sort()).toEqual([...WORLDS].sort());
    expect(WORLD_ORDER[0]).toBe('lamplight');
    expect(DEFAULT_WORLD).toBe('lamplight');
  });

  it('falls back to the default world for anything unknown', () => {
    expect(worldOf('jelly').id).toBe('jelly');
    for (const junk of [undefined, null, 42, 'nope', '__proto__', 'toString']) expect(worldOf(junk).id).toBe('lamplight');
  });

  for (const id of WORLDS) {
    describe(id, () => {
      const w = worlds[id];

      it('describes itself for the picker', () => {
        expect(w.id).toBe(id);
        expect(w.name.length).toBeGreaterThan(2);
        expect(w.description.length).toBeGreaterThan(20);
        expect(w.description.length).toBeLessThan(110);
        expect(w.companionName.length).toBeGreaterThan(0);
      });

      it('has springs that settle and an entrance that stays small', () => {
        for (const s of [w.motion.spring, w.motion.snappy]) {
          expect(dampingRatio(s)).toBeGreaterThan(0.3);
          expect(dampingRatio(s)).toBeLessThan(1.6);
        }
        expect(w.motion.enterDistance).toBeGreaterThanOrEqual(0);
        expect(w.motion.enterDistance).toBeLessThanOrEqual(24);
        expect(w.motion.enterScale).toBeGreaterThan(0.85);
        expect(w.motion.enterScale).toBeLessThanOrEqual(1);
      });

      it('has a short haptic pattern for every cue', () => {
        for (const cue of CUES) {
          const pattern = ([] as number[]).concat(w.haptics[cue]);
          expect(pattern.length).toBeGreaterThan(0);
          expect(pattern.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(250);
        }
      });

      it('loads a sound for every cue, quiet enough', async () => {
        const pack = await w.loadSound();
        for (const cue of CUES) {
          const spec = pack[cue];
          expect(spec.tones.length + (spec.noise ? 1 : 0)).toBeGreaterThan(0);
          for (const t of spec.tones) {
            expect(t.gain).toBeLessThanOrEqual(0.1);
            expect(t.attack + t.decay).toBeLessThan(1.5);
          }
        }
      });

      it('loads a voice pack that only uses known keys', async () => {
        const { baseVoice } = await import('@/lib/voice');
        const pack = await w.loadVoice();
        for (const key of Object.keys(pack)) expect(Object.keys(baseVoice)).toContain(key);
      });

      it('loads a constellation skin with a token for every family', async () => {
        const skin = await w.loadConstellationSkin();
        expect(Object.keys(skin.familyTokens).sort()).toEqual(['aims', 'feelings', 'world']);
        for (const token of Object.values(skin.familyTokens)) expect(token).toMatch(/^--[a-z0-9-]+$/);
      });

      it('has hero and companion slots', () => {
        expect(w.Hero).toBeTruthy();
        expect(w.Companion).toBeTruthy();
      });
    });
  }
});
