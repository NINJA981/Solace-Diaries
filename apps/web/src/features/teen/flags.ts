/**
 * Teen-mode UI rules, in one place so every feature applies the same ones.
 *
 *   const { streaks, nudges, shareCards, peopleMap } = useTeenFlags();   // booleans: is it allowed?
 *   const isTeen = useIsTeen();
 *
 * Teen accounts (13-17) get no streak counters, no behavioural nudges (reminders, "you haven't
 * written" prompts), no share cards and no map of the people in the journal. Adults get everything.
 * While the profile is still loading we assume the stricter teen rules, so nothing flashes.
 */
import type { Profile } from '@solace/shared';
import { useProfile } from '@/lib/session';

export type TeenFlags = {
  isTeen: boolean;
  /** Streak counters, "N days in a row" lines, streak slides. */
  streaks: boolean;
  /** Daily reminder, in-app nudges and any "you haven't written today" prompt. */
  nudges: boolean;
  /** Shareable quote/moment cards. */
  shareCards: boolean;
  /** The people/places constellation, "people" slides and person-centred summaries. */
  peopleMap: boolean;
};

const ADULT: TeenFlags = { isTeen: false, streaks: true, nudges: true, shareCards: true, peopleMap: true };
const TEEN: TeenFlags = { isTeen: true, streaks: false, nudges: false, shareCards: false, peopleMap: false };

/** Pure: the flags for a profile (undefined while loading → the teen rules). */
export function teenFlags(profile?: Pick<Profile, 'mode'> | null): TeenFlags {
  return profile?.mode === 'adult' ? ADULT : TEEN;
}

export function useTeenFlags(): TeenFlags {
  const { profile } = useProfile();
  return teenFlags(profile);
}

/** True only once we know the account is a teen account (false while loading). */
export function useIsTeen(): boolean {
  const { profile } = useProfile();
  return profile?.mode === 'teen';
}
