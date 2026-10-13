import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RedirectIfSignedIn, safeNext } from '@/app/guards';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/fields';
import { authErrorMessage, authRedirect } from '@/lib/auth-errors';
import { getSupabase } from '@/lib/supabase-lazy';
import { AuthLayout, CheckEmail, Divider, FormError, GoogleButton, PasswordInput } from './AuthLayout';

export async function signInWithGoogle(next: string) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authRedirect(next) },
  });
  if (error) throw error;
}

function LoginForm() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'password' | 'link' | 'google' | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password to sign in.');
      return;
    }
    setPending('password');
    try {
      const supabase = await getSupabase();
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      navigate(next, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err as Parameters<typeof authErrorMessage>[0]));
    } finally {
      setPending(null);
    }
  };

  const sendLink = async () => {
    setError(null);
    const address = email.trim();
    if (!address) {
      setError('Enter your email address first, then we’ll send the link there.');
      document.getElementById('login-email')?.focus();
      return;
    }
    setPending('link');
    try {
      const supabase = await getSupabase();
      const { error: err } = await supabase.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: authRedirect(next), shouldCreateUser: false },
      });
      // Don't reveal whether the address has an account: only real failures are shown.
      if (err && !['otp_disabled', 'user_not_found', 'signup_disabled'].includes(err.code ?? '')) throw err;
      setLinkSentTo(address);
    } catch (err) {
      setError(authErrorMessage(err as Parameters<typeof authErrorMessage>[0]));
    } finally {
      setPending(null);
    }
  };

  const google = async () => {
    setError(null);
    setPending('google');
    try {
      await signInWithGoogle(next);
    } catch (err) {
      setError(authErrorMessage(err as Parameters<typeof authErrorMessage>[0]));
      setPending(null);
    }
  };

  if (linkSentTo) {
    return (
      <AuthLayout title="Check your email" intro="Open the link on this device to sign in. It works once and expires after an hour.">
        <CheckEmail email={linkSentTo}>
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setLinkSentTo(null)}>
            Use a different email
          </Button>
        </CheckEmail>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      intro="Sign in to pick up where you left off."
      footer={
        <>
          New to Solace?{' '}
          <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-lamp underline-offset-4 hover:underline">
            Start your journal
          </Link>
        </>
      }
    >
      <GoogleButton onClick={() => void google()} loading={pending === 'google'} />
      <Divider>or use your email</Divider>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <FormError>{error}</FormError>
        <Input
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-1 text-right">
            <Link
              to="/reset"
              className="inline-flex min-h-11 items-center text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline sm:min-h-8"
            >
              Forgot your password?
            </Link>
          </div>
        </div>
        <Button type="submit" className="h-11 w-full text-base" loading={pending === 'password'}>
          Sign in
        </Button>
        <Button variant="ghost" className="w-full" loading={pending === 'link'} onClick={() => void sendLink()}>
          Email me a sign-in link instead
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <RedirectIfSignedIn>
      <LoginForm />
    </RedirectIfSignedIn>
  );
}
