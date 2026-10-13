import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { buttonClasses } from '@/components/ui/Button';
import { errorMessage } from '@/lib/errors';
import { NotFoundContent } from './NotFound';

/** A deploy replaced the chunk this tab was about to load. */
function isStaleChunk(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(message);
}

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundContent />;

  const stale = isStaleChunk(error);
  const inApp = typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

  // Inside the app shell there's already a <main>.
  const Tag = inApp ? 'section' : 'main';
  return (
    <Tag id={inApp ? undefined : 'main'} className="mx-auto flex min-h-[70dvh] max-w-lg flex-col justify-center px-6 py-16">
      <p aria-hidden="true" className="font-serif text-4xl text-lamp">✶</p>
      <h1 className="mt-4 font-serif text-3xl font-normal text-fg">
        {stale ? 'Solace was just updated' : 'This page ran into a problem'}
      </h1>
      <p className="mt-3 text-fg-muted">
        {stale
          ? 'A newer version is available. Reload to continue; anything you’ve written is saved.'
          : 'Your writing is safe. Reloading usually fixes this; if it keeps happening, try again in a few minutes.'}
      </p>
      {!stale && import.meta.env.DEV && (
        <pre className="mt-4 overflow-auto rounded-control bg-sunken p-3 text-xs text-fg-muted">{errorMessage(error)}</pre>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className={buttonClasses('primary')} onClick={() => window.location.reload()}>
          Reload page
        </button>
        <Link to={inApp ? '/app/today' : '/'} className={buttonClasses('secondary')} reloadDocument>
          {inApp ? 'Go to Today' : 'Go to the home page'}
        </Link>
      </div>
    </Tag>
  );
}
