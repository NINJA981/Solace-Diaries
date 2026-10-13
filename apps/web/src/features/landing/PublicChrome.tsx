import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonClasses } from '@/components/ui/Button';
import { Wordmark } from '@/components/layout/Logo';
import { SkipLink } from '@/components/layout/SkipLink';
import { useSession } from '@/lib/session';

export function PublicHeader({ className }: { className?: string }) {
  const { status } = useSession();
  const signedIn = status === 'signed-in';
  return (
    <header className={clsx('relative z-20', className)}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="Solace home" className="rounded-control">
          <Wordmark />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
          {signedIn ? (
            <Link to="/app/today" className={buttonClasses('primary', 'sm')}>
              Open your journal
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClasses('ghost', 'sm', 'text-fg')}>
                Sign in
              </Link>
              <span className="hidden min-[380px]:contents">
                <Link to="/signup" className={buttonClasses('primary', 'sm')}>
                  Start your journal
                </Link>
              </span>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark />
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
            <li>
              <Link className="hover:text-fg" to="/privacy">
                Privacy
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" to="/terms">
                Terms
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" to="/login">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/** Header + main + footer for public pages. */
export function PublicPage({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <SkipLink />
      <PublicHeader />
      <main id="main" tabIndex={-1} className={clsx('flex-1 outline-none', mainClassName)}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
