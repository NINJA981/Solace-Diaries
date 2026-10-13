import { clsx } from 'clsx';
import { useRef, type KeyboardEvent } from 'react';

export type TabItem = { value: string; label: string; disabled?: boolean; controls?: string };

export type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  /** Accessible name for the tab list. */
  label?: string;
  className?: string;
  /** Prefix for tab element ids, so panels can use aria-labelledby=`${idPrefix}-${value}`. */
  idPrefix?: string;
};

/** A tab list with roving tabindex and automatic activation (arrows, Home, End). */
export function Tabs({ value, onValueChange, items, label, className, idPrefix }: TabsProps) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((i) => i.value === value);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onValueChange(target.value);
    refs.current.get(target.value)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx('inline-flex items-center gap-1 rounded-control border border-line bg-sunken p-1', className)}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
              else refs.current.delete(item.value);
            }}
            id={idPrefix ? `${idPrefix}-${item.value}` : undefined}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={item.controls}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            className={clsx(
              'h-8 rounded-[6px] px-3 text-sm font-medium transition-colors disabled:opacity-50',
              selected ? 'bg-raised text-fg shadow-[var(--shadow-card)]' : 'text-fg-muted hover:text-fg',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
