/**
 * The voice layer: moment copy that each world may say in its own voice (greetings, streak
 * lines, empty states, confirmations, intros, onboarding headlines, celebrations). Functional
 * copy (labels, buttons, statuses, errors, accessible names) stays shared, in the components.
 *
 *   const voice = useVoice();
 *   voice.greeting({ hour, name })   voice.journalEmptyTitle   toast(voiceNow().entryDeleted)
 *
 * The base strings are today's copy, word for word: Lamplight speaks the base voice, and every
 * other world falls back to it for any key its pack (manifest.loadVoice) leaves out.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { plural } from '@/features/journal-core/format';
import { readWorld, useDeviceWorld } from '@/lib/theme';
import { worlds } from '@/worlds';
import type { WorldId } from '@/worlds/types';

/** "Good morning" … for a local hour (0-23). */
export function partOfDay(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Streak lengths that count as a milestone (gentle; never a loss). */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

export const baseVoice = {
  // Today
  greeting: ({ hour, name }: { hour: number; name?: string }): string => `${partOfDay(hour)}${name ? `, ${name}` : ''}`,
  streakStarted: 'You’ve started a streak.',
  streakDays: (days: number): string => `${plural(days, 'day')} in a row.`,
  /** Shown instead of streakDays on a milestone day (see STREAK_MILESTONES). */
  streakMilestone: (days: number): string => `${plural(days, 'day')} in a row.`,
  reminderLine: (time: string): string => `You planned to write around ${time}. A few lines is enough.`,
  reminderToast: 'Your writing hour is here. A few lines is enough.',
  todayPlaceholder: 'Write anything. It saves as you go.',
  entryPlaceholder: 'What’s on your mind?',
  promptIntro: 'A question for today',
  promptIntroMemory: 'From something you wrote recently',
  recentEmpty: 'Entries you write will collect here.',

  // Solace at work
  readingEntry: 'Solace is reading this entry…',
  readingWeek: 'Solace is reading your week…',
  noteLabel: 'Solace’s note',
  reflectIntroTitle: 'Ask your journal anything.',
  reflectIntroBody: 'Solace answers from what you’ve written and shows you which entries it used.',
  reflectThinking: 'Looking through your journal…',

  // Empty states
  journalEmptyTitle: 'Your journal is empty',
  journalEmptyBody: 'Everything you write lands here, newest first. Solace starts noticing patterns after a few entries.',
  insightsEmptyTitle: 'Insights grow with your journal',
  insightsEmptyBody:
    'Write a few entries and this page fills in: your streaks, a year of days, how your moods move, and a letter about your week.',
  skyEmptyTitle: 'Your sky is still forming',
  skyEmptyBody: 'After a few more entries, the things you write about most will appear here as stars.',
  memoriesEmptyTitle: 'Nothing remembered yet',
  memoriesEmptyBody: 'As you write, Solace notes the people, places and patterns that matter to you. They’ll appear here.',
  searchEmptyTitle: 'No entries match',

  // Confirmations
  profileSaved: 'Profile saved.',
  entryDeleted: 'Entry deleted',
  memoryUpdated: 'Memory updated',
  memoryDeleted: 'Memory deleted',
  photoRemoved: 'Photo removed',
  reflectionDeleted: 'Reflection deleted',
  accountDeleted: 'Your account and journal have been deleted. Thank you for writing with Solace.',

  // Onboarding
  onboardingNameTitle: 'What should Solace call you?',
  onboardingNameIntro: 'Just a first name is fine. It’s only used inside your journal.',
  onboardingWorldTitle: 'How should your journal feel?',
  onboardingWorldIntro: 'Each world has its own colours, type, motion and sounds. You can switch any time in Settings.',
  onboardingDayTitle: 'When does your day happen?',
  onboardingDayIntro: 'Your timezone decides which day an entry belongs to, so late-night writing lands on the right date.',
  onboardingVoiceTitle: 'How should Solace talk with you?',
  onboardingVoiceIntro: 'This sets the tone of Reflect answers and your weekly letter. You can change it any time in Settings.',
  onboardingStart: 'Start writing',
};

export type VoicePack = typeof baseVoice;
export type VoiceKey = keyof VoicePack;

const packs = new Map<WorldId, Partial<VoicePack>>();
const merged = new Map<WorldId, VoicePack>();
const loading = new Set<WorldId>();
const listeners = new Set<() => void>();

/** The voice for a world: its pack over the base strings (base until the pack has loaded). */
export function voiceFor(world: WorldId): VoicePack {
  const pack = packs.get(world);
  if (!pack) return baseVoice;
  let voice = merged.get(world);
  if (!voice) {
    voice = { ...baseVoice, ...pack };
    merged.set(world, voice);
  }
  return voice;
}

/** For copy written outside React (toasts in callbacks): the voice of the current world. */
export function voiceNow(): VoicePack {
  return voiceFor(readWorld());
}

/** Starts loading a world's pack (idempotent). The app calls this when a world becomes active. */
export function preloadVoice(world: WorldId): Promise<void> {
  if (packs.has(world) || loading.has(world)) return Promise.resolve();
  const manifest = worlds[world];
  if (!manifest) return Promise.resolve();
  loading.add(world);
  return manifest
    .loadVoice()
    .then(
      (pack) => pack,
      () => ({}),
    )
    .then((pack) => {
      loading.delete(world);
      packs.set(world, pack);
      merged.delete(world);
      listeners.forEach((l) => l());
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current world's voice. Re-renders when the world changes or its pack arrives. */
export function useVoice(): VoicePack {
  const world = useDeviceWorld();
  useEffect(() => {
    void preloadVoice(world);
  }, [world]);
  return useSyncExternalStore(
    subscribe,
    () => voiceFor(world),
    () => baseVoice,
  );
}

/** Test helper. */
export function setVoicePackForTests(world: WorldId, pack: Partial<VoicePack> | null): void {
  if (pack) packs.set(world, pack);
  else packs.delete(world);
  merged.delete(world);
  listeners.forEach((l) => l());
}
