import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { feedback } from '@/lib/feedback';

export type ToastTone = 'default' | 'success' | 'danger';
export type ToastOptions = {
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 keeps it until dismissed. Defaults to 5s (8s with an action). */
  duration?: number;
  /** Replaces an existing toast with the same id instead of stacking. */
  id?: string;
};
export type ToastItem = { id: string; message: string; tone: ToastTone; action?: ToastOptions['action']; duration: number };

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let counter = 0;

export function dismissToast(id: string) {
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
    // Sound and haptics (only if the person turned them on): confirmations and errors.
    if (item.tone === 'danger') feedback('error');
    else if (item.tone === 'success') feedback('save');
    return id;
  },
  { dismiss: dismissToast },
);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The animated list (motion/react) loads with the first toast; the live regions exist from the
// start so screen readers announce what lands in them.
const loadItems = () => import('./ToastItems');
const ToastItems = lazy(loadItems);
/** Warm the toast chunk ahead of the first toast (the signed-in app does this on mount). */
export function preloadToasts(): void {
  void loadItems().catch(() => {});
}

/** Mount once near the root. Danger toasts go to an assertive region, the rest polite. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  const [armed, setArmed] = useState(false);
  if (list.length > 0 && !armed) setArmed(true);
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
        {armed && (
          <Suspense fallback={null}>
            <ToastItems items={urgent} />
          </Suspense>
        )}
      </ol>
      <ol aria-live="polite" aria-label="Notifications" className="flex flex-col gap-2">
        {armed && (
          <Suspense fallback={null}>
            <ToastItems items={polite} />
          </Suspense>
        )}
      </ol>
    </div>
  );
}
