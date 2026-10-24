import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { buttonClasses } from '@/components/ui/Button';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useSession } from '@/lib/session';

/** Public: shown after the age gate says under 13. The account is already deleted. */
export default function AgeRestrictedPage() {
  const { state } = useLocation() as { state: { clearSession?: boolean } | null };
  const { signOut } = useSession();
  const clear = state?.clearSession === true;
  useEffect(() => {
    // The account is already gone: forget the session and anything stored in this browser.
    if (clear) void signOut({ scope: 'local', reason: 'deleted' }).catch(() => {});
  }, [clear, signOut]);
  return (
    <AuthLayout title="Solace is for ages 13 and up">
      <div className="flex flex-col gap-4 leading-relaxed text-fg-muted">
        <p>
          Thanks for being honest with us. Solace is a journal that uses AI, and we can only offer it to people who are
          13 or older.
        </p>
        <p>
          <strong className="font-medium text-fg">We haven’t kept anything.</strong> The account you just started has
          been deleted, including your email address, and nothing was written to it.
        </p>
        <p>
          Writing in a notebook is a lovely way to sort out your thoughts in the meantime. If something is weighing on
          you, talking to a parent, carer or teacher can really help, and in India you can call CHILDLINE on{' '}
          <a className="font-medium text-fg underline" href="tel:1098">
            1098
          </a>{' '}
          any time, for free.
        </p>
        <p>We’d be glad to see you again when you’re 13.</p>
      </div>
      <div className="mt-8">
        <Link to="/" className={buttonClasses('secondary', 'md')}>
          Back to the start
        </Link>
      </div>
    </AuthLayout>
  );
}
