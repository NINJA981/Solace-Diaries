import { MOOD_SCORE, type Mood, type WeekMood } from '@solace/shared';

/** Mood folded into three valence bands (the ramp's two poles and its neutral middle). */
export type Band = 'low' | 'neutral' | 'bright';
export const BANDS: { key: Band; label: string; color: string }[] = [
  { key: 'low', label: 'Heavy', color: 'var(--mood-1)' },
  { key: 'neutral', label: 'Steady', color: 'var(--mood-3)' },
  { key: 'bright', label: 'Bright', color: 'var(--mood-5)' },
];

export type WeekRow = {
  weekStart: string;
  avg: number | null;
  low: number;
  neutral: number;
  bright: number;
  total: number;
};

export function bandOf(mood: Mood): Band {
  const s = MOOD_SCORE[mood];
  return s < 0 ? 'low' : s > 0 ? 'bright' : 'neutral';
}

/** Weekly rows for the chart: average valence plus counts per band. */
export function toWeekRows(trend: WeekMood[]): WeekRow[] {
  return trend.map((w) => {
    const row: WeekRow = { weekStart: w.weekStart, avg: w.avgScore, low: 0, neutral: 0, bright: 0, total: 0 };
    for (const [mood, n] of Object.entries(w.counts)) {
      if (!(mood in MOOD_SCORE)) continue;
      row[bandOf(mood as Mood)] += n;
      row.total += n;
    }
    return row;
  });
}

/** "Mostly bright" style summary of a valence average. */
export function describeAvg(avg: number | null): string {
  if (avg === null) return 'no moods recorded';
  if (avg >= 1.25) return 'very bright';
  if (avg >= 0.4) return 'mostly bright';
  if (avg > -0.4) return 'steady';
  if (avg > -1.25) return 'mostly heavy';
  return 'very heavy';
}

/** Nice upper bound for the count axis. */
export function niceMax(n: number): number {
  if (n <= 4) return 4;
  if (n <= 6) return 6;
  if (n <= 10) return 10;
  return Math.ceil(n / 5) * 5;
}
