import type { PastLetterList } from '@solace/shared';

export type WriteState = { canWrite: boolean; reason: string | null };

/** Whether the "Write this month's letter" button is live, and why not when it isn't. */
export function writeState(list: Pick<PastLetterList, 'items' | 'canWrite' | 'minEntries'>, thisMonth: string): WriteState {
  if (list.canWrite) return { canWrite: true, reason: null };
  if (list.items.some((l) => l.month === thisMonth))
    return { canWrite: false, reason: 'This month’s letter is already written. The next one can be written next month.' };
  return {
    canWrite: false,
    reason: `Letters from past you need at least ${list.minEntries} entries older than about three months to draw on. Keep writing and this will open up.`,
  };
}

export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}
