import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RedirectIfSignedIn, safeNext } from '@/app/guards';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/fields';
import { toast } from '@/components/ui/toast';
import { MIN_PASSWORD, authErrorMessage, authRedirect } from '@/lib/auth-errors';
import { getSupabase } from '@/lib/supabase-lazy';
import { AuthLayout, CheckEmail, Divider, FormError, GoogleButton, PasswordInput } from './AuthLayout';
import { signInWithGoogle } from './LoginPage';

type AuthErr = Parameters<typeof authErrorMessage>[0];

function SignupForm() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'google' | 'resend' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setPending('email');
    try {
      const supabase = await getSupabase();
      const address = email.trim();
      const { data, error: err } = await supabase.auth.signUp({
        email: address,
        password,
        options: { emailRedirectTo: authRedirect(next) },
      });
      if (err) throw err;
      if (data.session) navigate('/onboarding', { replace: true });
      else setSentTo(address);
    } catch (err) {
      setError(authErrorMessage(err as AuthErr));
    } finally {
      setPending(null);
    }
  };

  const resend = async () => {
    if (!sentTo) return;
    setPending('resend');
    try {
      const supabase = await getSupabase();
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: authRedirect(next) } });
      if (err) throw err;
      toast('Sent another confirmation email.', { tone: 'success' });
    } catch (err) {
      toast(authErrorMessage(err as AuthErr), { tone: 'danger' });
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
      setError(authErrorMessage(err as AuthErr));
      setPending(null);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout title="Confirm your email" intro="Open the link in that email to finish creating your journal.">
        <CheckEmail email={sentTo}>
          <div className="-ml-3 flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" loading={pending === 'resend'} onClick={() => void resend()}>
              Send it again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
          </div>
        </CheckEmail>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Start your journal"
      intro="It takes a minute. You can export or delete everything whenever you like."
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <GoogleButton onClick={() => void google()} loading={pending === 'google'} label="Sign up with Google" />
      <Divider>or use your email</Divider>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <FormError>{error}</FormError>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          showStrength
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="mt-1 h-11 w-full text-base" loading={pending === 'email'}>
          Create account
        </Button>
        <p className="text-xs leading-relaxed text-fg-faint">
          By creating an account you agree to the{' '}
          <Link to="/terms" className="underline underline-offset-2 hover:text-fg-muted">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-fg-muted">
            Privacy policy
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <RedirectIfSignedIn>
      <SignupForm />
    </RedirectIfSignedIn>
  );
}
