// Owned by the web platform layer. STUB — replaced in Phase 1 (agent C).
//
// Contract for consumers (agent D):
//   useSession(): { status: 'loading'|'signed-in'|'signed-out', userId: string|null, email: string|null, signOut(): Promise<void> }
//   useProfile(): { profile: Profile | undefined, isLoading: boolean }  — TanStack Query, key ['me']
//   useTimezone(): string — profile.timezone, falling back to the browser's zone
import type { Profile } from '@solace/shared';

export function useProfile(): { profile: Profile | undefined; isLoading: boolean } {
  return { profile: undefined, isLoading: true };
}
export function useTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
