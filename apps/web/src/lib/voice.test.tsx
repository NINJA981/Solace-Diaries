import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetAppearanceForTests, setDeviceWorld } from './theme';
import { baseVoice, partOfDay, setVoicePackForTests, useVoice, voiceFor, voiceNow } from './voice';

afterEach(() => {
  setVoicePackForTests('jelly', null);
  localStorage.clear();
  resetAppearanceForTests();
});

describe('voice layer', () => {
  it('speaks today’s copy as the base voice (e2e and screen readers rely on it)', () => {
    expect(baseVoice.greeting({ hour: 20, name: 'Robin' })).toBe('Good evening, Robin');
    expect(baseVoice.greeting({ hour: 3 })).toBe('Still up');
    expect(baseVoice.onboardingNameTitle).toBe('What should Solace call you?');
    expect(baseVoice.onboardingDayTitle).toBe('When does your day happen?');
    expect(baseVoice.onboardingVoiceTitle).toBe('How should Solace talk with you?');
    expect(baseVoice.onboardingStart).toBe('Start writing');
    expect(baseVoice.memoriesEmptyTitle).toBe('Nothing remembered yet');
    expect(baseVoice.streakStarted).toBe('You’ve started a streak.');
    expect(baseVoice.streakDays(4)).toBe('4 days in a row.');
  });

  it('greets by the time of day', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(partOfDay)).toEqual([
      'Still up',
      'Good morning',
      'Good morning',
      'Good afternoon',
      'Good afternoon',
      'Good evening',
      'Good evening',
    ]);
  });

  it('has about forty moments', () => {
    expect(Object.keys(baseVoice).length).toBeGreaterThanOrEqual(38);
  });

  it('falls back to base for every key a world leaves out', () => {
    setVoicePackForTests('jelly', { journalEmptyTitle: 'No pages yet!', greeting: ({ name }) => `Hiya${name ? `, ${name}` : ''}` });
    const jelly = voiceFor('jelly');
    expect(jelly.journalEmptyTitle).toBe('No pages yet!');
    expect(jelly.greeting({ hour: 9, name: 'Sam' })).toBe('Hiya, Sam');
    expect(jelly.insightsEmptyTitle).toBe(baseVoice.insightsEmptyTitle);
    expect(voiceFor('chrome')).toBe(baseVoice);
  });

  it('follows the device world, inside and outside React', () => {
    setVoicePackForTests('jelly', { entryDeleted: 'Poof, gone' });
    const { result } = renderHook(() => useVoice());
    expect(result.current.entryDeleted).toBe('Entry deleted');
    act(() => setDeviceWorld('jelly'));
    expect(result.current.entryDeleted).toBe('Poof, gone');
    expect(voiceNow().entryDeleted).toBe('Poof, gone');
  });
});
