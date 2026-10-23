import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/fields';
import { authErrorMessage, authRedirect } from '@/lib/auth-errors';
import { getSupabase } from '@/lib/supabase-lazy';
import { AuthLayout, CheckEmail, FormError } from './AuthLayout';

/** Errors worth showing: they don't reveal whether an account exists. */
const SHOWABLE = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'email_address_invalid']);

export default function ResetRequestPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) {
      setError('Enter the email address you signed up with.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const supabase = await getSupabase();
      const { error: err } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: authRedirect('/reset/update'),
      });
      const network = err && (err.name === 'AuthRetryableFetchError' || err.status === 0);
      if (err && (network || SHOWABLE.has(err.code ?? ''))) throw err;
      setSentTo(address);
    } catch (err) {
      setError(authErrorMessage(err as Parameters<typeof authErrorMessage>[0]));
    } finally {
      setPending(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        intro="If there’s an account for this address, a link to choose a new password is on its way."
        footer={
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <CheckEmail email={sentTo} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter the email you signed up with and we’ll send you a link to choose a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
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
        <Button type="submit" className="h-11 w-full text-base" loading={pending}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
