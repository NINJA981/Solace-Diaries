import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { FullPageLoader } from '@/app/guards';
import { Button, buttonClasses } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { MIN_PASSWORD, authErrorMessage } from '@/lib/auth-errors';
import { useSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase-lazy';
import { AuthLayout, FormError, PasswordInput } from './AuthLayout';

export default function ResetUpdatePage() {
  const { status } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (status === 'loading') return <FullPageLoader label="Checking your link" />;

  if (status === 'signed-out') {
    return (
      <AuthLayout title="This link has expired" intro="Password reset links work once and expire after an hour. Request a fresh one and try again.">
        <Link to="/reset" className={buttonClasses('primary', 'md', 'h-11 w-full text-base')}>
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Your password needs at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('The two passwords don’t match. Type them again.');
    setPending(true);
    try {
      const supabase = await getSupabase();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      toast('Password updated.', { tone: 'success' });
      navigate('/app/today', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err as Parameters<typeof authErrorMessage>[0]));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" intro="You’ll use it the next time you sign in on any device.">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <FormError>{error}</FormError>
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          showStrength
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" className="mt-1 h-11 w-full text-base" loading={pending}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
