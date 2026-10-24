import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/lib/errors';
import { gateTarget } from '@/features/teen/age';
import { ME_QUERY_KEY, browserTimezone, useProfile, useSession } from '@/lib/session';
import { useProfileAppearanceSync } from '@/lib/world';

export function FullPageLoader({ label = 'Loading your journal' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas text-fg-muted">
      <Spinner label={label} size={22} />
    </div>
  );
}

/** Only same-origin, path-only redirects are honoured (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/app/today'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

export function loginRedirect(pathname: string, search: string): string {
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}

/** One-time fix-up: new profiles default to UTC; adopt the browser's zone if it differs. */
function useTimezoneAdoption() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const tried = useRef(false);
  useEffect(() => {
    if (!profile || tried.current) return;
    const zone = browserTimezone();
    if (profile.timezone !== 'UTC' || zone === 'UTC') return;
    tried.current = true;
    void import('@/lib/api')
      .then(({ api }) => api.updateMe({ body: { timezone: zone } }))
      .then((next) => queryClient.setQueryData(ME_QUERY_KEY, next))
      .catch(() => {
        /* non-critical: onboarding and Settings let the person set it */
      });
  }, [profile, queryClient]);
}

/**
 * Gate for signed-in areas. Signed-out → /login?next=…; when `requireOnboarded`, people who
 * haven't finished onboarding go there first.
 */
export function RequireAuth({
  children,
  requireOnboarded = true,
  enforceGates = true,
}: {
  children: ReactNode;
  requireOnboarded?: boolean;
  /** Send people who have not answered the age gate (or a teen without a parent's OK) to those screens. Off on those screens themselves. */
  enforceGates?: boolean;
}) {
  const { status } = useSession();
  const { profile, isLoading, error } = useProfile();
  const { pathname, search } = useLocation();
  const queryClient = useQueryClient();
  useTimezoneAdoption();
  // The profile's world wins over this device's, and its sound/haptics choices switch feedback on.
  useProfileAppearanceSync();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signed-out') return <Navigate to={loginRedirect(pathname, search)} replace />;
  if (isLoading) return <FullPageLoader />;
  if (!profile) {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <h1 className="type-heading text-2xl">We couldn’t open your journal</h1>
        <p className="mt-3 text-fg-muted">{errorMessage(error, 'Your profile didn’t load.')}</p>
        <div className="mt-6">
          <Button onClick={() => void queryClient.refetchQueries({ queryKey: ME_QUERY_KEY })}>Try again</Button>
        </div>
      </main>
    );
  }
  const gate = enforceGates ? gateTarget(profile) : null;
  if (gate) return <Navigate to={gate} replace />;
  if (requireOnboarded && !profile.onboardingDone) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** For /login and /signup: people who are already signed in go straight to `next`. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [params] = useSearchParams();
  if (status === 'signed-in') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <>{children}</>;
}
