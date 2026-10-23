import { clsx } from 'clsx';
import { Check, CloudOff, LoaderCircle, CircleAlert } from 'lucide-react';
import type { EngineSnapshot } from './syncEngine';

export function statusText(s: EngineSnapshot): string {
  switch (s.status) {
    case 'empty':
      return '';
    case 'pending':
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'offline':
      return 'Offline. Saved on this device';
    case 'retrying':
      return 'Couldn’t save. Retrying…';
    case 'conflict':
      return 'Two versions. Choose one';
    case 'failed':
      return s.error ? `Couldn’t save. ${s.error}` : 'Couldn’t save';
  }
}

/** Plain-words save state. Announced politely; never steals focus. */
export function SaveStatus({ snapshot, onResolve }: { snapshot: EngineSnapshot; onResolve?: () => void }) {
  const text = statusText(snapshot);
  const s = snapshot.status;
  const icon =
    s === 'saved' ? (
      <Check className="size-3.5" aria-hidden="true" />
    ) : s === 'offline' ? (
      <CloudOff className="size-3.5" aria-hidden="true" />
    ) : s === 'pending' || s === 'saving' ? (
      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    ) : s === 'empty' ? null : (
      <CircleAlert className="size-3.5" aria-hidden="true" />
    );
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <span
        role="status"
        aria-live="polite"
        className={clsx(
          'inline-flex min-w-0 items-center gap-1.5',
          s === 'retrying' || s === 'failed' || s === 'conflict' ? 'text-danger' : s === 'offline' ? 'text-fg-muted' : 'text-fg-faint',
        )}
      >
        {icon}
        <span className="truncate">{text}</span>
      </span>
      {s === 'conflict' && onResolve && (
        <button
          type="button"
          onClick={onResolve}
          className="relative font-medium text-accent underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
        >
          Review
        </button>
      )}
    </span>
  );
}
