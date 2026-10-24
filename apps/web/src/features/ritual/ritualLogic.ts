import { localDate, weekStart, type WeeklyRitualInput } from '@solace/shared';

export type Cadence = 'none' | 'daily' | 'weekly';
export type RitualDraft = { step: number; highs: string; lows: string; intention: string; cadence: Cadence };

export const EMPTY_DRAFT: RitualDraft = { step: 0, highs: '', lows: '', intention: '', cadence: 'none' };
export const STEP_COUNT = 3;

const DRAFT_KEY = 'solace.ritual-draft';
const DONE_KEY = 'solace.ritual-done';

/** Whether it is Sunday for the person right now. */
export function isSunday(now: Date, tz: string): boolean {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now) === 'Sunday';
}

export function currentWeek(now: Date, tz: string): string {
  return weekStart(localDate(now, tz));
}

export function hasAnswer(d: RitualDraft): boolean {
  return !!(d.highs.trim() || d.lows.trim() || d.intention.trim());
}

/** The API body, or null when nothing has been answered yet. */
export function buildInput(d: RitualDraft, tz: string): WeeklyRitualInput | null {
  if (!hasAnswer(d)) return null;
  const title = d.intention.trim();
  return {
    highs: d.highs.trim(),
    lows: d.lows.trim(),
    ...(title ? { intention: { title: title.slice(0, 120), kind: 'goal' as const, cadence: d.cadence } } : {}),
    tz,
  };
}

function parse(raw: string | null): RitualDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RitualDraft>;
    const cadence = v.cadence === 'daily' || v.cadence === 'weekly' ? v.cadence : 'none';
    return {
      step: Math.min(STEP_COUNT - 1, Math.max(0, Number.isInteger(v.step) ? (v.step as number) : 0)),
      highs: typeof v.highs === 'string' ? v.highs : '',
      lows: typeof v.lows === 'string' ? v.lows : '',
      intention: typeof v.intention === 'string' ? v.intention : '',
      cadence,
    };
  } catch {
    return null;
  }
}

/** Drafts live on this device only, per person, until they are submitted. */
export function loadDraft(userId: string): RitualDraft {
  try {
    return parse(localStorage.getItem(`${DRAFT_KEY}:${userId}`)) ?? EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(userId: string, d: RitualDraft): void {
  try {
    if (hasAnswer(d)) localStorage.setItem(`${DRAFT_KEY}:${userId}`, JSON.stringify(d));
    else localStorage.removeItem(`${DRAFT_KEY}:${userId}`);
  } catch {
    /* storage unavailable: the draft just won't survive a reload */
  }
}

export function clearDraft(userId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_KEY}:${userId}`);
  } catch {
    /* ignore */
  }
}

/** Forget everything the weekly review keeps on this device for `userId` (private text). */
export function clearRitualData(userId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_KEY}:${userId}`);
    localStorage.removeItem(`${DONE_KEY}:${userId}`);
  } catch {
    /* ignore */
  }
}

export function markDone(userId: string, week: string): void {
  try {
    localStorage.setItem(`${DONE_KEY}:${userId}`, week);
  } catch {
    /* ignore */
  }
}

export function isDone(userId: string, week: string): boolean {
  try {
    return localStorage.getItem(`${DONE_KEY}:${userId}`) === week;
  } catch {
    return false;
  }
}
