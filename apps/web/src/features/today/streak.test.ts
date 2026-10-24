import { describe, expect, it } from 'vitest';
import { baseVoice } from '@/lib/voice';
import { visibleStreak } from './streak';

describe('teen mode', () => {
  it('hides streak counts', () => {
    expect(visibleStreak('teen', 12)).toBe(0);
    expect(visibleStreak('adult', 12)).toBe(12);
    expect(visibleStreak(undefined, undefined)).toBe(0);
  });
});

describe('time and memory voice keys', () => {
  it('are present, plain and free of guilt copy', () => {
    const keys = [
      'rememberWhenTitle', 'capsuleLinkLabel', 'capsuleLinkHint', 'weeklyReviewTitle', 'weeklyReviewBody',
      'capsulesEmptyTitle', 'capsulesEmptyBody', 'capsuleReadyLine', 'capsuleRevealTitle', 'capsuleDeleted',
      'ritualIntro', 'ritualHighsTitle', 'ritualLowsTitle', 'ritualIntentionTitle', 'ritualDoneTitle', 'ritualDoneBody',
    ] as const;
    for (const k of keys) {
      expect(baseVoice[k]).toMatch(/\S/);
      expect(baseVoice[k]).not.toMatch(/miss|streak|lost|behind|don.t break|AI-powered/i);
    }
    expect(baseVoice.capsuleSealed('1 May 2027')).toBe('Sealed. It opens on 1 May 2027.');
  });
});
