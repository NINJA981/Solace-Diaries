import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Motion, enterFrom, useWorldMotion } from '@/lib/motion';
import { dismissToast, type ToastItem } from './toast';

function ToastView({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  const { presets, snappy, reduced, fade } = useWorldMotion();

  useEffect(() => {
    if (!item.duration || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [item.id, item.duration, paused]);

  return (
    <m.li
      initial={enterFrom(presets, reduced, presets.enterDistance + 2)}
      animate={{ opacity: 1, y: 0, scale: 1, transition: reduced ? fade : snappy }}
      exit={{ opacity: 0, ...(reduced ? {} : { scale: 0.97 }), transition: { duration: 0.14, ease: 'easeIn' } }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        'pointer-events-auto flex w-full items-center gap-3 rounded-card border bg-raised py-2.5 pr-2 pl-4 text-sm text-fg shadow-2',
        item.tone === 'danger' ? 'border-danger/50' : item.tone === 'success' ? 'border-success/40' : 'border-line-strong',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'size-1.5 shrink-0 rounded-full',
          item.tone === 'danger' ? 'bg-danger' : item.tone === 'success' ? 'bg-success' : 'bg-accent',
        )}
      />
      <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
      {item.action && (
        <button
          type="button"
          className="h-8 shrink-0 rounded-control px-2.5 font-medium text-accent hover:bg-accent-soft max-sm:min-h-11"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        className="grid size-8 shrink-0 place-items-center rounded-control text-fg-faint hover:bg-sunken hover:text-fg max-sm:size-11"
        onClick={() => dismissToast(item.id)}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </m.li>
  );
}

/** The toasts in one live region; they spring in with the world's motion and fade out. */
export default function ToastItems({ items }: { items: ToastItem[] }) {
  return (
    <Motion>
      <AnimatePresence>
        {items.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </Motion>
  );
}
