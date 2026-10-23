import { Link, useLocation } from 'react-router';
import { buttonClasses } from '@/components/ui/Button';

export function NotFoundContent() {
  const { pathname } = useLocation();
  const inApp = pathname.startsWith('/app');
  const Tag = inApp ? 'section' : 'main';
  return (
    <Tag id={inApp ? undefined : 'main'} className="mx-auto flex min-h-[70dvh] max-w-lg flex-col justify-center px-6 py-16">
      <p aria-hidden="true" className="font-display text-5xl text-fg-faint">404</p>
      <h1 className="mt-4 type-heading text-3xl text-fg">There’s no page here</h1>
      <p className="mt-3 text-fg-muted">The link may be old, or the address may have a typo.</p>
      <div className="mt-8">
        <Link to={inApp ? '/app/today' : '/'} className={buttonClasses('secondary')}>
          {inApp ? 'Go to Today' : 'Go to the home page'}
        </Link>
      </div>
    </Tag>
  );
}

export default function NotFound() {
  return <NotFoundContent />;
}
