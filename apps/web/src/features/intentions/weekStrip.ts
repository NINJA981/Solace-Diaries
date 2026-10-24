import { addDays, type Intention } from '@solace/shared';

/** Today and the six days before it, oldest first. `today` is the person's local date. */
export function weekDates(today: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
}

/** Weekday name for a local calendar date. Computed in UTC so the viewer's timezone cannot shift it. */
export function weekdayOf(date: string, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

export type StripDay = { date: string; checked: boolean; isToday: boolean; label: string };

export function stripFor(intention: Pick<Intention, 'checkins'>, today: string): StripDay[] {
  const done = new Set(intention.checkins.map((c) => c.date));
  return weekDates(today).map((date) => ({
    date,
    checked: done.has(date),
    isToday: date === today,
    label: `${weekdayOf(date, 'long')} ${dayNumber(date)}`,
  }));
}

/** Check-ins in the visible week: shown to adults only. */
export function weekCount(intention: Pick<Intention, 'checkins'>, today: string): number {
  return stripFor(intention, today).filter((d) => d.checked).length;
}
