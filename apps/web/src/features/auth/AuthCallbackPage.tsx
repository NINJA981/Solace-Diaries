import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { safeNext } from '@/app/guards';
import { buttonClasses } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { authErrorMessage } from '@/lib/auth-errors';
import { getSupabase } from '@/lib/supabase-lazy';
import { AuthLayout } from './AuthLayout';

// One exchange per code, even if the effect runs twice (StrictMode) or the page re-renders.
const exchanges = new Map<string, Promise<{ ok: boolean; message?: string }>>();

function exchange(code: string) {
  let pending = exchanges.get(code);
  if (!pending) {
    pending = getSupabase()
      .then((supabase) => supabase.auth.exchangeCodeForSession(code))
      .then(({ error }) => (error ? { ok: false, message: authErrorMessage(error) } : { ok: true }))
      .catch((error: unknown) => ({
        ok: false,
        message: authErrorMessage(error as Parameters<typeof authErrorMessage>[0]),
      }));
    exchanges.set(code, pending);
  }
  return pending;
}

/**
 * Landing point for email confirmations, magic links, password-reset links and Google
 * sign-in (PKCE). Exchanges `?code=` for a session, then continues to `next`.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  // Provider errors arrive in the URL, so they are known before the first render.
  const [error, setError] = useState<string | null>(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const errorCode =
      url.searchParams.get('error_code') ??
      hash.get('error_code') ??
      url.searchParams.get('error') ??
      hash.get('error');
    if (!errorCode) return null;
    const description = url.searchParams.get('error_description') ?? hash.get('error_description');
    return authErrorMessage({ code: errorCode, message: description ?? undefined });
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const get = (k: string) => url.searchParams.get(k) ?? hash.get(k);
    const next = safeNext(get('next'));
    const errorCode = get('error_code') ?? get('error');
    const code = get('code');
    let cancelled = false;

    if (errorCode) return; // already shown via the initial state
    if (!code) {
      void getSupabase()
        .then((s) => s.auth.getSession())
        .then(({ data }) => {
          if (cancelled) return;
          if (data.session) navigate(next, { replace: true });
          else
            setError(
              'This link is incomplete. Open it again from your email, or request a new one.',
            );
        });
      return () => {
        cancelled = true;
      };
    }
    void exchange(code).then((result) => {
      if (cancelled) return;
      if (result.ok) navigate(next, { replace: true });
      else setError(result.message ?? 'We couldn’t sign you in with that link.');
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <AuthLayout title="That link didn’t work" intro={error}>
        <div className="flex flex-col gap-3">
          <Link to="/login" className={buttonClasses('primary', 'md', 'h-11 w-full text-base')}>
            Go to sign in
          </Link>
          <Link to="/reset" className={buttonClasses('ghost', 'md', 'w-full')}>
            Reset your password instead
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-ink px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner label="Signing you in" size={22} />
        <h1 className="font-serif text-2xl font-normal text-fg">Signing you in…</h1>
      </div>
    </main>
  );
}
