/**
 * Display formatting for local calendar dates (`YYYY-MM-DD`). These strings are already in
 * the user's timezone, so we format them as UTC instants to avoid any shift.
 */
import { MOOD_SCORE, type Mood } from '@solace/shared';

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' });
    fmtCache.set(key, f);
  }
  return f;
}

/** "Mon, Mar 3" (adds the year when it isn't the current one). */
export function formatDay(date: string, today?: string): string {
  const sameYear = today ? today.slice(0, 4) === date.slice(0, 4) : true;
  return fmt({ weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(
    utc(date),
  );
}

/** "Monday, March 3, 2025" */
export function formatLongDay(date: string): string {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(utc(date));
}

/** "Mar 3" */
export function formatShortDay(date: string): string {
  return fmt({ month: 'short', day: 'numeric' }).format(utc(date));
}

/** "March 2025" for a `YYYY-MM` or `YYYY-MM-DD` string. */
export function formatMonth(date: string): string {
  return fmt({ month: 'long', year: 'numeric' }).format(utc(`${date.slice(0, 7)}-01`));
}

export function formatMonthShort(date: string): string {
  return fmt({ month: 'short' }).format(utc(`${date.slice(0, 7)}-01`));
}

/** "Today", "Yesterday", or a short day. */
export function relativeDay(date: string, today: string): string {
  if (date === today) return 'Today';
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  if (date === yesterday) return 'Yesterday';
  return formatDay(date, today);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/** 1,284 / 12.9K / 1.2M — for stat values. */
export function compactNumber(n: number): string {
  if (n < 10_000) return formatNumber(n);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Hour (0-23) right now in `tz`. */
export function localHour(tz: string, at = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at);
  return Number(h) % 24;
}

export function moodLabel(mood: Mood): string {
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

/** Index 1..5 into the `--mood-N` ramp for a valence score (−2..+2). */
export function moodStep(score: number): 1 | 2 | 3 | 4 | 5 {
  const step = Math.round(Math.max(-2, Math.min(2, score))) + 3;
  return step as 1 | 2 | 3 | 4 | 5;
}

export function moodStepFor(mood: Mood): 1 | 2 | 3 | 4 | 5 {
  return moodStep(MOOD_SCORE[mood]);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
