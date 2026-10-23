import { plural } from '@/features/journal-core/format';
import type { VoicePack } from '@/lib/voice';

/**
 * Scrapbook's voice: a margin note from someone who likes you. Warm and tactile (pages, tape,
 * pencil, albums) and a little wry, never precious. A day is a page, a streak is pages pasted
 * in, and nothing ever scolds: there is no such thing as a gap in a scrapbook. Functional copy
 * (deleting, errors, privacy, the account) stays in the shared base voice by being left out.
 */
const voice: Partial<VoicePack> = {
  // Today
  greeting: ({ hour, name }) => {
    const part = hour < 5 ? 'Late-night page' : hour < 12 ? 'Morning page' : hour < 18 ? 'Afternoon page' : 'Evening page';
    return `${part}${name ? `, ${name}` : ''}`;
  },
  streakStarted: 'Day one is pasted in.',
  streakDays: (days) => `${plural(days, 'page')} in a row.`,
  streakMilestone: (days) => `${plural(days, 'page')} in a row. That earns a gold star sticker.`,
  reminderLine: (time) => `You pencilled in ${time} for writing. A few lines is enough.`,
  reminderToast: 'Your page is waiting. A few lines is enough.',
  todayPlaceholder: 'Start anywhere. It saves as you go.',
  entryPlaceholder: 'What do you want to remember?',
  promptIntro: 'A question for the margin',
  promptIntroMemory: 'Clipped from something you wrote',
  recentEmpty: 'Pages you write will be pinned up here.',

  // Solace at work
  readingEntry: 'Solace is reading this page…',
  readingWeek: 'Solace is leafing through your week…',
  noteLabel: 'Solace’s margin note',
  reflectIntroBody: 'Solace answers from what you’ve written and shows you which pages it used.',
  reflectThinking: 'Leafing through your journal…',

  // Empty states
  journalEmptyTitle: 'A blank album',
  journalEmptyBody: 'Everything you write is pasted in here, newest first. After a few pages, Solace starts noticing patterns.',
  insightsEmptyTitle: 'Insights fill in as you write',
  insightsEmptyBody:
    'Write a few pages and this fills in: your streaks, a year of days, how your moods move, and a letter about your week.',
  skyEmptyTitle: 'The tags are still blank',
  skyEmptyBody: 'After a few more pages, the things you write about most get their own tags here.',
  memoriesEmptyTitle: 'Nothing clipped yet',
  memoriesEmptyBody: 'As you write, Solace jots down the people, places and patterns that matter to you. They’ll be pinned here.',
  searchEmptyTitle: 'Nothing matches that',

  // Onboarding
  onboardingNameTitle: 'What should we write on the cover?',
  onboardingNameIntro: 'A first name is plenty. It only appears inside your journal.',
  onboardingWorldTitle: 'How should your journal look?',
  onboardingStart: 'Open the first page',
};
export default voice;
