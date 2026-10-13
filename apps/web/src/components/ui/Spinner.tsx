import { clsx } from 'clsx';

export function Spinner({
  label = 'Loading',
  size = 18,
  decorative = false,
  className,
}: {
  label?: string;
  size?: number;
  /** Inside a busy button the button itself announces state. */
  decorative?: boolean;
  className?: string;
}) {
  const svg = (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={clsx('animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]', className)}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
  if (decorative) return svg;
  return (
    <span role="status" className="inline-flex items-center text-fg-muted">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
