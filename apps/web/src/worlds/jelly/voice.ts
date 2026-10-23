import { plural } from '@/features/journal-core/format';
import type { VoicePack } from '@/lib/voice';

/**
 * Jelly's voice: playful, lowercase-friendly and warm, like a friend who is pleased you showed
 * up. Titles and short moments go lowercase; anything longer keeps sentence case so it stays
 * easy to read. Never childish, never a nudge: a missed day is not a thing here (streaks only
 * ever celebrate), and anything functional (deleting, errors, privacy, account) stays in the
 * shared, plain base copy by being left out of this pack.
 */
const voice: Partial<VoicePack> = {
  // Today
  greeting: ({ hour, name }) => {
    const part = hour < 5 ? 'night owl hours' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return `${part}${name ? `, ${name}` : ''}`;
  },
  streakStarted: 'streak started. nice one.',
  streakDays: (days) => `${plural(days, 'day')} in a row. nice.`,
  streakMilestone: (days) => `${plural(days, 'day')} in a row. big wiggle energy.`,
  reminderLine: (time) => `your writing time is around ${time}. a few lines is plenty.`,
  reminderToast: 'writing time! a few lines is plenty.',
  todayPlaceholder: 'Write anything. It saves as you go.',
  entryPlaceholder: 'What’s on your mind?',
  promptIntro: 'today’s little question',
  promptIntroMemory: 'something you wrote recently',
  recentEmpty: 'your entries will pile up here.',

  // Solace at work
  readingEntry: 'Solace is reading this one…',
  readingWeek: 'Solace is flipping through your week…',
  reflectIntroTitle: 'ask your journal anything.',
  reflectThinking: 'digging through your journal…',

  // Empty states
  journalEmptyTitle: 'nothing here yet',
  journalEmptyBody: 'Everything you write lands here, newest first. After a few entries, Solace starts spotting patterns.',
  insightsEmptyTitle: 'insights are brewing',
  insightsEmptyBody:
    'Write a few entries and this page fills up: your streaks, a year of days, how your moods move, and a letter about your week.',
  skyEmptyTitle: 'the jar is still empty',
  skyEmptyBody: 'After a few more entries, the things you write about most will show up here as gummies.',
  memoriesEmptyTitle: 'nothing remembered yet',
  memoriesEmptyBody: 'As you write, Solace notes the people, places and patterns that matter to you. They’ll show up here.',
  searchEmptyTitle: 'no entries match',

  // Confirmations (deletions and the account stay plain)
  profileSaved: 'Profile saved!',
  memoryUpdated: 'Memory updated!',

  // Onboarding
  onboardingNameTitle: 'what should Solace call you?',
  onboardingNameIntro: 'Just a first name is perfect. It only lives inside your journal.',
  onboardingWorldTitle: 'how should your journal feel?',
  onboardingWorldIntro: 'Each world has its own colours, type, motion and sounds. Swap any time in Settings.',
  onboardingStart: 'Let’s write',
};
export default voice;
