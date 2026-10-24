import type { Milestone } from '@solace/shared';

const KEY = 'solace.milestones-seen';

/**
 * Milestones achieved that this device has not celebrated yet. The first time there is nothing
 * to compare with (`seen` is null), so everything already achieved counts as seen: the
 * companion celebrates what is new, never a backlog.
 */
export function newMilestones(milestones: readonly Milestone[] | undefined, seen: readonly string[] | null): Milestone[] {
  if (!milestones || seen === null) return [];
  const known = new Set(seen);
  return milestones.filter((m) => m.achievedAt && !known.has(m.key));
}

export function achievedKeys(milestones: readonly Milestone[] | undefined): string[] {
  return (milestones ?? []).filter((m) => m.achievedAt).map((m) => m.key);
}

export function readSeen(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${KEY}:${userId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function clearSeen(userId: string): void {
  try {
    localStorage.removeItem(`${KEY}:${userId}`);
  } catch {
    /* ignore */
  }
}

export function writeSeen(userId: string, keys: readonly string[]): void {
  try {
    localStorage.setItem(`${KEY}:${userId}`, JSON.stringify(keys));
  } catch {
    /* storage unavailable: the companion just won't remember */
  }
}

export type CompanionReaction = 'idle' | 'saved' | 'celebrate';

/** How long a reaction shows before the companion settles again. */
export const REACTION_MS: Record<Exclude<CompanionReaction, 'idle'>, number> = { saved: 2200, celebrate: 3600 };

/** A celebration outranks a save; neither is replaced by idle until it expires. */
export function pickReaction(current: CompanionReaction, next: Exclude<CompanionReaction, 'idle'>): CompanionReaction {
  return current === 'celebrate' && next === 'saved' ? 'celebrate' : next;
}

/** Whether a sync status change means "a save just landed". */
export function isSaveLanding(prev: string | null | undefined, next: string | null | undefined): boolean {
  return next === 'saved' && (prev === 'saving' || prev === 'pending' || prev === 'retrying' || prev === 'offline');
}
