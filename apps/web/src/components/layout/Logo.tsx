import { clsx } from 'clsx';

/** Three stars joined into a tiny constellation: the Solace mark. */
export function LogoMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className={clsx('text-accent', className)}>
      <path d="M4.5 17.5 10.5 7.5 19.5 12.5" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.5" cy="17.5" r="2" fill="currentColor" />
      <circle cx="10.5" cy="7.5" r="2.6" fill="currentColor" />
      <circle cx="19.5" cy="12.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-display text-brand leading-none font-medium tracking-brand text-fg">Solace</span>
    </span>
  );
}
