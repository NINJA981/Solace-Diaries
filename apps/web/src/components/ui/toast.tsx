import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type ToastTone = 'default' | 'success' | 'danger';
export type ToastOptions = {
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 keeps it until dismissed. Defaults to 5s (8s with an action). */
  duration?: number;
  /** Replaces an existing toast with the same id instead of stacking. */
  id?: string;
};
type ToastItem = { id: string; message: string; tone: ToastTone; action?: ToastOptions['action']; duration: number };

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let counter = 0;

function dismiss(id: string) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message in the aria-live toast region. Returns the toast id. */
export const toast = Object.assign(
  (message: string, opts: ToastOptions = {}): string => {
    const id = opts.id ?? `t${++counter}`;
    const item: ToastItem = {
      id,
      message,
      tone: opts.tone ?? 'default',
      action: opts.action,
      duration: opts.duration ?? (opts.action ? 8000 : 5000),
    };
    items = [...items.filter((t) => t.id !== id), item].slice(-4);
    emit();
    return id;
  },
  { dismiss },
);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function ToastView({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!item.duration || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [item.id, item.duration, paused]);

  return (
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        'pointer-events-auto flex w-full items-center gap-3 rounded-card border bg-raised py-2.5 pr-2 pl-4 text-sm text-fg',
        'shadow-[0_18px_40px_-20px_rgb(5_8_20/0.8)] animate-[toast-in_200ms_ease-out]',
        item.tone === 'danger' ? 'border-danger/50' : item.tone === 'success' ? 'border-success/40' : 'border-line-strong',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'size-1.5 shrink-0 rounded-full',
          item.tone === 'danger' ? 'bg-danger' : item.tone === 'success' ? 'bg-success' : 'bg-lamp',
        )}
      />
      <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
      {item.action && (
        <button
          type="button"
          className="h-8 shrink-0 rounded-control px-2.5 font-medium text-lamp hover:bg-lamp-soft max-sm:min-h-11"
          onClick={() => {
            item.action?.onClick();
            dismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        className="grid size-8 shrink-0 place-items-center rounded-control text-fg-faint hover:bg-sunken hover:text-fg max-sm:size-11"
        onClick={() => dismiss(item.id)}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Mount once near the root. Danger toasts go to an assertive region, the rest polite. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  const polite = list.filter((t) => t.tone !== 'danger');
  const urgent = list.filter((t) => t.tone === 'danger');
  return (
    <div
      className={
        'pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4 ' +
        'bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:right-6 md:bottom-6 md:left-auto md:mx-0 md:px-0'
      }
    >
      <ol aria-live="assertive" aria-label="Alerts" className="flex flex-col gap-2">
        {urgent.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </ol>
      <ol aria-live="polite" aria-label="Notifications" className="flex flex-col gap-2">
        {polite.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </ol>
    </div>
  );
}
