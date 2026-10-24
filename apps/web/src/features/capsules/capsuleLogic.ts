/**
 * Pure helpers for time capsules: unlock-date presets, validation that mirrors the API
 * (at least 24 hours ahead, at most 25 years), and display status.
 */
import { CAPSULE_LIMITS, addDays, localDate, type Capsule, type CapsuleStatus } from '@solace/shared';

export type Preset = '1m' | '6m' | '1y' | 'custom';
export const PRESETS: { value: Preset; label: string }[] = [
  { value: '1m', label: '1 month' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: 'custom', label: 'Pick a date' },
];

/** The hour (local) a capsule opens on its date. */
export const UNLOCK_HOUR = 9;

/** Add whole months to a YYYY-MM-DD date, clamping to the end of a shorter month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function presetDate(preset: Exclude<Preset, 'custom'>, today: string): string {
  return addMonths(today, preset === '1m' ? 1 : preset === '6m' ? 6 : 12);
}

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant that is `hour`:00 on local `date` in `tz`. */
export function localInstant(date: string, tz: string, hour = UNLOCK_HOUR): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = 3_600_000;

/** Now plus the maximum lead, in calendar years (leap days included). */
function maxInstant(now: Date): number {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + CAPSULE_LIMITS.maxYears);
  return d.getTime();
}

/** The earliest date that still opens at least minLeadHours from now. */
export function earliestDate(now: Date, tz: string): string {
  let date = localDate(now, tz);
  for (let i = 0; i < 4; i++) {
    if (localInstant(date, tz).getTime() - now.getTime() >= CAPSULE_LIMITS.minLeadHours * HOUR) return date;
    date = addDays(date, 1);
  }
  return date;
}

/** The latest date that is still within maxYears. */
export function latestDate(now: Date, tz: string): string {
  let date = addMonths(localDate(now, tz), CAPSULE_LIMITS.maxYears * 12);
  while (localInstant(date, tz).getTime() > maxInstant(now)) date = addDays(date, -1);
  return date;
}

/** An error message for an unlock date, or null when it is fine. */
export function validateUnlock(date: string, now: Date, tz: string): string | null {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'Choose the day it should open.';
  const at = localInstant(date, tz).getTime();
  const lead = at - now.getTime();
  if (lead < CAPSULE_LIMITS.minLeadHours * HOUR) return 'Pick a day at least 24 hours from now.';
  if (at > maxInstant(now)) return `Pick a day within ${CAPSULE_LIMITS.maxYears} years.`;
  return null;
}

export type CapsuleDraftErrors = { title?: string; body?: string; date?: string };
export function validateDraft(d: { title: string; body: string; date: string }, now: Date, tz: string): CapsuleDraftErrors {
  const errors: CapsuleDraftErrors = {};
  if (!d.title.trim()) errors.title = 'Give your letter a title.';
  else if (d.title.trim().length > CAPSULE_LIMITS.titleMax) errors.title = `Keep the title under ${CAPSULE_LIMITS.titleMax} characters.`;
  if (!d.body.trim()) errors.body = 'Write something for future you.';
  const date = validateUnlock(d.date, now, tz);
  if (date) errors.date = date;
  return errors;
}

/** Server status, upgraded on this device's clock: a sealed capsule past its date is ready. */
export function capsuleStatus(c: Pick<Capsule, 'status' | 'unlockAt'>, now: Date): CapsuleStatus {
  if (c.status === 'opened') return 'opened';
  return Date.parse(c.unlockAt) <= now.getTime() ? 'ready' : 'sealed';
}

/** Ready first, then sealed by soonest date, then opened by most recent. */
export function sortCapsules(items: Capsule[], now: Date): Capsule[] {
  const rank = { ready: 0, sealed: 1, opened: 2 } as const;
  return [...items].sort((a, b) => {
    const sa = capsuleStatus(a, now);
    const sb = capsuleStatus(b, now);
    if (sa !== sb) return rank[sa] - rank[sb];
    if (sa === 'opened') return Date.parse(b.openedAt ?? b.unlockAt) - Date.parse(a.openedAt ?? a.unlockAt);
    return Date.parse(a.unlockAt) - Date.parse(b.unlockAt);
  });
}

/** "in 12 days", "in 3 months", "in 2 years" (rounded, calm). */
export function timeUntil(unlockAt: string, now: Date): string {
  const days = Math.max(0, Math.floor((Date.parse(unlockAt) - now.getTime()) / 86_400_000));
  if (days < 1) return 'later today';
  if (days < 60) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 700) return `in ${Math.round(days / 30.44)} months`;
  return `in ${Math.round(days / 365.25)} years`;
}

/** Display date for an instant in the person's timezone. */
export function formatUnlock(unlockAt: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: tz }).format(new Date(unlockAt));
}
