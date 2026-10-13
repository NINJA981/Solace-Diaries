/**
 * Session + profile state.
 *
 *   useSession(): { status: 'loading'|'signed-in'|'signed-out', userId, email, signOut(opts?) }
 *   useProfile(): { profile: Profile | undefined, isLoading: boolean }  — TanStack Query, key ['me']
 *   useTimezone(): string — profile.timezone, falling back to the browser's zone
 *
 * The Supabase SDK is loaded lazily so the public pages stay light.
 */
import type { Profile } from '@solace/shared';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler } from './auth-events';
import { clearDeviceData, syncBeforeSignOut } from './device-data';
import { getSupabase } from './supabase-lazy';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

/**
 * Why the session ends, which decides what this browser forgets:
 *  - 'user' (default): sync unsaved drafts (bounded), then clear the BYOK key and this
 *    person's drafts/queue, so the next account on a shared browser starts clean.
 *  - 'deleted': the account is gone; clear everything without trying to sync.
 *  - 'expired': a 401 ended the session. Clear the BYOK key but keep the drafts (scoped to
 *    this user, never sent to another account) so words typed before expiry sync on sign-in.
 */
export type SignOutReason = 'user' | 'deleted' | 'expired';

export type SessionValue = {
  status: SessionStatus;
  userId: string | null;
  email: string | null;
  /** `scope: 'global'` signs out every device (Settings → Account). */
  signOut(opts?: { scope?: 'local' | 'global'; reason?: SignOutReason }): Promise<void>;
};

export const ME_QUERY_KEY = ['me'] as const;

const SessionContext = createContext<SessionValue | null>(null);

const PUBLIC_PATHS = new Set(['/', '/privacy', '/terms']);

function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(cb, 1200);
  return () => window.clearTimeout(t);
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ status: SessionStatus; session: Session | null }>({
    status: 'loading',
    session: null,
  });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const start = () =>
      getSupabase()
      .then(async (supabase) => {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (cancelled) return;
          setState({ status: session ? 'signed-in' : 'signed-out', session });
          if (event === 'SIGNED_OUT') queryClient.clear();
        });
        unsubscribe = () => data.subscription.unsubscribe();
        const { data: current } = await supabase.auth.getSession();
        if (!cancelled) {
          setState({ status: current.session ? 'signed-in' : 'signed-out', session: current.session });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'signed-out', session: null });
      });
    // Public marketing pages don't need the auth SDK for first paint: load it when idle.
    const cancelIdle = PUBLIC_PATHS.has(window.location.pathname) ? whenIdle(start) : (void start(), undefined);
    return () => {
      cancelled = true;
      cancelIdle?.();
      unsubscribe?.();
    };
  }, [queryClient]);

  const signOut = useCallback(
    async (opts?: { scope?: 'local' | 'global'; reason?: SignOutReason }) => {
      const reason = opts?.reason ?? 'user';
      const supabase = await getSupabase();
      let userId: string | null = null;
      try {
        userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      } catch {
        /* no session to read */
      }
      // Still signed in: give unsaved words a short chance to reach the server first.
      if (reason === 'user' && userId) await syncBeforeSignOut(userId);
      try {
        const { error } = await supabase.auth.signOut({ scope: opts?.scope ?? 'local' });
        // A failed global sign-out (network) still ends this device's session.
        if (error) await supabase.auth.signOut({ scope: 'local' });
      } finally {
        // Never discard unsynced writing on a normal sign-out; only a deleted account loses it.
        await clearDeviceData(reason === 'expired' ? null : userId, {
          keepUnsyncedDrafts: reason === 'user',
        });
      }
      queryClient.clear();
      setState({ status: 'signed-out', session: null });
    },
    [queryClient],
  );

  // Any 401 from the API ends the local session; the route guard sends the person to
  // /login?next=<where they were>.
  useEffect(() => {
    setUnauthorizedHandler(() => signOut({ scope: 'local', reason: 'expired' }));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<SessionValue>(
    () => ({
      status: state.status,
      userId: state.session?.user.id ?? null,
      email: state.session?.user.email ?? null,
      signOut,
    }),
    [state, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

export function useProfile(): { profile: Profile | undefined; isLoading: boolean; error: unknown } {
  const { status, userId } = useSession();
  const enabled = status === 'signed-in';
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }) => (await import('./api')).api.getMe({ signal }),
    enabled,
    staleTime: 5 * 60_000,
    meta: { userId },
  });
  return {
    profile: enabled ? query.data : undefined,
    isLoading: status === 'loading' || (enabled && query.isPending),
    error: query.error,
  };
}

export function useTimezone(): string {
  const { profile } = useProfile();
  return profile?.timezone ?? browserTimezone();
}
