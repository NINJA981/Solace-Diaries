/**
 * Journal persona for Solace Unwrapped. Built ONLY from aggregates (when, how much, how
 * varied), never from entry text, so it is deterministic and private by construction.
 */
import type { JournalPersona } from '@solace/shared';

export type PersonaStats = {
  entries: number;
  activeDays: number;
  /** Days in the period that have elapsed so far (>= 1). */
  elapsedDays: number;
  avgWords: number;
  /** Entries per local hour. */
  byHour: number[];
  /** Entries per weekday, Monday first. */
  byWeekday: number[];
  /** One valence score (-2..2) per entry that has a mood. */
  moodScores: number[];
  distinctMoods: number;
  distinctTags: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function derived(s: PersonaStats) {
  const total = Math.max(s.entries, 1);
  const night = sum([21, 22, 23, 0, 1, 2, 3].map((h) => s.byHour[h] ?? 0)) / total;
  const early = sum([4, 5, 6, 7, 8].map((h) => s.byHour[h] ?? 0)) / total;
  const weekend = ((s.byWeekday[5] ?? 0) + (s.byWeekday[6] ?? 0)) / total;
  const consistency = s.activeDays / Math.max(s.elapsedDays, 1);
  const n = s.moodScores.length;
  const mean = n ? sum(s.moodScores) / n : 0;
  const spread = n ? Math.sqrt(sum(s.moodScores.map((x) => (x - mean) ** 2)) / n) : 0;
  return { night, early, weekend, consistency, spread, moodN: n, mean };
}

type Def = {
  key: string;
  name: string;
  description: string;
  match: (s: PersonaStats, d: ReturnType<typeof derived>) => boolean;
};

/** Ordered: the first rule that matches wins. */
export const PERSONAS: Def[] = [
  {
    key: 'night_owl',
    name: 'Night-owl processor',
    description:
      'You do your best sorting-out after the world goes quiet. The late hours are where your thoughts settle into words.',
    match: (_s, d) => d.night >= 0.4,
  },
  {
    key: 'early_riser',
    name: 'Early-bird reflector',
    description:
      'You meet the page before the day gets loud. Writing first thing seems to set the tone for everything after.',
    match: (_s, d) => d.early >= 0.4,
  },
  {
    key: 'deep_diver',
    name: 'Deep-dive writer',
    description:
      'When you sit down to write, you stay a while. Your entries run long, and you let a thought unfold all the way.',
    match: (s) => s.avgWords >= 250,
  },
  {
    key: 'daily_ritualist',
    name: 'Daily ritualist',
    description:
      'Journaling is part of your rhythm now. You keep showing up, and the habit itself is holding you steady.',
    match: (_s, d) => d.consistency >= 0.75,
  },
  {
    key: 'wide_ranging',
    name: 'Wide-ranging feeler',
    description:
      'Your moods covered a lot of ground, and you wrote through all of it. That honesty is the point of a journal.',
    match: (s, d) => d.moodN >= 3 && s.distinctMoods >= 5 && d.spread >= 1.2,
  },
  {
    key: 'steady_water',
    name: 'Steady-water observer',
    description:
      'Your entries held a calm, even tone. You tend to notice and describe rather than ride the waves.',
    match: (s, d) => d.moodN >= 3 && s.distinctMoods <= 3 && d.spread <= 0.7,
  },
  {
    key: 'curious_collector',
    name: 'Curious collector',
    description:
      'You tag and sort your life into many threads: work, people, places, ideas. Your journal reads like a well-kept notebook of interests.',
    match: (s) => s.distinctTags >= 8,
  },
  {
    key: 'quick_noter',
    name: 'Quick-note minimalist',
    description:
      'A few honest lines are enough for you. Short entries, caught in the moment, add up to a surprisingly clear picture.',
    match: (s) => s.avgWords > 0 && s.avgWords <= 40,
  },
  {
    key: 'weekend_wanderer',
    name: 'Weekend wanderer',
    description:
      'Your journal comes alive when the week loosens its grip. Weekends are when you have room to look back and think.',
    match: (_s, d) => d.weekend >= 0.5,
  },
  {
    key: 'everyday_noticer',
    name: 'Everyday noticer',
    description:
      'You write through the ordinary daytime hours, catching small moments as they happen. Not every entry needs to be big.',
    match: () => true,
  },
];

function traitsFor(s: PersonaStats, d: ReturnType<typeof derived>): string[] {
  const t: string[] = [];
  if (d.night >= 0.4) t.push('Writes after dark');
  else if (d.early >= 0.4) t.push('Writes at dawn');
  else t.push('Writes in the daytime');
  if (d.consistency >= 0.75) t.push('Shows up almost daily');
  else if (d.consistency >= 0.35) t.push('Returns regularly');
  else t.push('Writes when it matters');
  if (s.avgWords >= 250) t.push('Long, unhurried entries');
  else if (s.avgWords <= 40) t.push('Short and to the point');
  else t.push('Balanced entry length');
  if (d.moodN >= 3) t.push(d.spread >= 1.2 ? 'Wide emotional range' : d.spread <= 0.7 ? 'Even emotional tone' : 'Mixed moods');
  if (s.distinctTags >= 8) t.push('Many themes');
  if (d.weekend >= 0.5) t.push('Weekend writer');
  return t.slice(0, 4);
}

export function derivePersona(s: PersonaStats): JournalPersona {
  const d = derived(s);
  const def = PERSONAS.find((p) => p.match(s, d))!;
  return { key: def.key, name: def.name, description: def.description, traits: traitsFor(s, d) };
}
