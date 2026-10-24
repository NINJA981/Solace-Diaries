import type { VoicePack } from '@/lib/voice';
import { partOfDay } from '@/lib/voice';

/**
 * Chrome's voice: clear, confident, a little technical. Short declaratives, real numbers, verbs
 * that say what happened. Never cold, never shaming: a missed day is a gap in the data, not a
 * failure, and Solace never counts anything against the person. Functional copy (labels,
 * buttons, errors) stays shared; this pack only has the moments.
 */
const voice: Partial<VoicePack> = {
  // Today
  greeting: ({ hour, name }) => `${partOfDay(hour)}${name ? `, ${name}` : ''}. Ready when you are.`,
  streakStarted: 'Streak started: day 1.',
  streakDays: (days) => `${days} ${days === 1 ? 'day' : 'days'} logged in a row.`,
  streakMilestone: (days) => `${days} ${days === 1 ? 'day' : 'days'} in a row. That is a real run.`,
  reminderLine: (time) => `Writing window at ${time}. A few lines counts.`,
  reminderToast: 'Your writing window is open. A few lines counts.',
  todayPlaceholder: 'Write anything. It saves as you go.',
  entryPlaceholder: 'What happened? What did you notice?',
  promptIntro: 'Today’s question',
  promptIntroMemory: 'Pulled from your recent writing',
  recentEmpty: 'Nothing logged yet. Entries show up here as you write them.',

  // Solace at work
  readingEntry: 'Reading this entry…',
  readingWeek: 'Reading your week…',
  noteLabel: 'Solace’s read',
  reflectIntroTitle: 'Query your journal.',
  reflectIntroBody: 'Ask in plain words. Solace answers from your entries and lists exactly which ones it used.',
  reflectThinking: 'Searching your entries…',

  // Empty states
  journalEmptyTitle: 'No entries yet',
  journalEmptyBody: 'Everything you write lands here, newest first. Patterns start to show after a few entries.',
  insightsEmptyTitle: 'Insights need a few entries',
  insightsEmptyBody: 'Write a few entries and this page fills in: streaks, a year of days, mood over time and a weekly letter.',
  skyEmptyTitle: 'Constellation not mapped yet',
  skyEmptyBody: 'A few more entries and the people, places and goals you write about most appear here as linked nodes.',
  memoriesEmptyTitle: 'No memories stored',
  memoriesEmptyBody: 'As you write, Solace notes the people, places and patterns that matter to you. You can review every one here.',
  searchEmptyTitle: 'No matches',

  // Confirmations
  profileSaved: 'Profile saved.',
  entryDeleted: 'Entry deleted.',
  memoryUpdated: 'Memory updated.',
  memoryDeleted: 'Memory deleted.',
  photoRemoved: 'Photo removed.',
  reflectionDeleted: 'Reflection deleted.',
  accountDeleted: 'Your account and journal are deleted. Thank you for writing with Solace.',

  // Onboarding
  onboardingNameTitle: 'What should Solace call you?',
  onboardingNameIntro: 'A first name is enough. It stays inside your journal.',
  onboardingWorldTitle: 'Choose your interface.',
  onboardingWorldIntro: 'Each world sets colour, type, motion and sound. Switch any time in Settings.',
  onboardingDayTitle: 'Set your day boundary.',
  onboardingDayIntro: 'Your timezone decides which date an entry belongs to, so late-night writing is filed correctly.',
  onboardingVoiceTitle: 'Set Solace’s tone.',
  onboardingVoiceIntro: 'This shapes Reflect answers and your weekly letter. You can change it any time in Settings.',
  onboardingStart: 'Start writing',
};
export default voice;
