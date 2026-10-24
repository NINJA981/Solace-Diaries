/** Age-gate helpers. Only a birth year and month are ever collected, never a day. */
import type { Profile } from '@solace/shared';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Newest first, a hundred years back. Under-13 birth years are included on purpose. */
export function birthYearOptions(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return Array.from({ length: 101 }, (_, i) => y - i);
}

export function parseBirth(year: string, month: string): { birthYear: number; birthMonth: number } | null {
  const birthYear = Number(year);
  const birthMonth = Number(month);
  if (!year || !month || !Number.isInteger(birthYear) || !Number.isInteger(birthMonth)) return null;
  if (birthMonth < 1 || birthMonth > 12 || birthYear < 1900) return null;
  return { birthYear, birthMonth };
}

/** Same rule as the server: in the birth month assume the birthday has not happened yet. */
export function conservativeAge(year: number, month: number, now: Date = new Date()): number {
  return now.getUTCFullYear() - year - (month >= now.getUTCMonth() + 1 ? 1 : 0);
}

export const isTeenAge = (age: number) => age >= 13 && age < 18;

export type GateTarget = '/age' | '/teen' | null;

/** Where a signed-in person must go before they can use the app (null = nowhere, carry on). */
export function gateTarget(profile: Pick<Profile, 'ageConfirmed' | 'mode' | 'consentStatus'>): GateTarget {
  if (!profile.ageConfirmed) return '/age';
  if (profile.mode === 'teen' && profile.consentStatus !== 'granted') return '/teen';
  return null;
}
