import { clsx } from 'clsx';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Wordmark } from '@/components/layout/Logo';
import { SkipLink } from '@/components/layout/SkipLink';
import { Input, type InputProps } from '@/components/ui/fields';
import { config } from '@/lib/config';
import { MIN_PASSWORD, passwordStrength } from '@/lib/auth-errors';

/** Quiet, centered frame for sign-in, sign-up and password pages. */
export function AuthLayout({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-canvas">
      <SkipLink />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_60%_at_50%_0%,var(--accent-soft),transparent_70%)]"
      />
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-5 sm:px-8">
        <Link to="/" aria-label="Solace home" className="-my-2 rounded-control py-2">
          <Wordmark />
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-5 pt-10 pb-16 outline-none sm:pt-16">
        <div className="w-full max-w-[25rem]">
          {!config.supabaseConfigured && <SetupNotice />}
          <h1 className="type-title text-title leading-tight text-fg">{title}</h1>
          {intro && <div className="mt-3 leading-relaxed text-fg-muted">{intro}</div>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 border-t border-line pt-6 text-sm text-fg-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

function SetupNotice() {
  return (
    <div role="note" className="mb-8 rounded-card border border-dashed border-line-strong bg-sunken px-4 py-3 text-sm text-fg-muted">
      Sign-in isn’t set up in this environment yet. Add <code className="text-fg">VITE_SUPABASE_URL</code> and{' '}
      <code className="text-fg">VITE_SUPABASE_ANON_KEY</code> to <code className="text-fg">apps/web/.env</code>, then restart the
      dev server.
    </div>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-sm leading-snug text-fg">
      {children}
    </p>
  );
}

export function Divider({ children = 'or' }: { children?: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-fg-faint">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function GoogleG() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="size-[18px]">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GoogleButton({ onClick, loading, label = 'Continue with Google' }: { onClick: () => void; loading?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-control border border-line-strong bg-raised text-sm font-medium text-fg transition-colors hover:border-fg-faint hover:bg-sunken disabled:opacity-60"
    >
      <GoogleG />
      {label}
    </button>
  );
}

/** Password field with a show/hide toggle and an optional strength hint. */
export function PasswordInput({ showStrength = false, value, ...rest }: InputProps & { showStrength?: boolean; value: string }) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const hint = showStrength ? (
    <span className="flex items-center gap-2" aria-live="polite">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={clsx(
              'h-1 w-6 rounded-full transition-colors',
              value.length === 0
                ? 'bg-line'
                : strength === 0
                  ? i === 0
                    ? 'bg-danger'
                    : 'bg-line'
                  : i <= strength
                    ? 'bg-success'
                    : 'bg-line',
            )}
          />
        ))}
      </span>
      {value.length === 0
        ? `At least ${MIN_PASSWORD} characters. A few unrelated words work well.`
        : strength === 0
          ? `${MIN_PASSWORD - value.length} more character${MIN_PASSWORD - value.length === 1 ? '' : 's'} to go`
          : strength === 1
            ? 'Good. Longer is even better.'
            : 'Strong password'}
    </span>
  ) : undefined;
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} value={value} hint={hint} className="pr-11" {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label="Show password"
        aria-pressed={visible}
        className="absolute top-[1.85rem] right-1 grid size-8 place-items-center rounded-control text-fg-faint hover:text-fg max-sm:top-[1.71rem] max-sm:right-0 max-sm:size-11"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
      </button>
    </div>
  );
}

export function CheckEmail({ email, children }: { email: string; children?: ReactNode }) {
  return (
    <div role="status" className="rounded-card border border-line bg-surface p-5">
      <p className="leading-relaxed text-fg">
        We sent a link to <span className="font-medium break-all">{email}</span>.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        It can take a minute to arrive. If you don’t see it, check your spam folder.
      </p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
