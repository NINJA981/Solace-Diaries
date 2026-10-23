import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';

/** An on/off setting: a native checkbox exposed as a switch, with a label and a hint. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex max-w-md items-start justify-between gap-6">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-1 text-sm leading-snug text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      <span className="relative mt-0.5 inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute -inset-x-1 -inset-y-2 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={clsx(
            'flex h-7 w-12 items-center rounded-pill border p-0.5 transition-colors',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
            'peer-disabled:opacity-55',
            checked ? 'border-accent bg-accent' : 'border-control-edge bg-sunken',
          )}
        >
          <span
            className={clsx(
              'size-5 rounded-pill shadow-1 transition-transform',
              checked ? 'translate-x-5 bg-accent-fg' : 'translate-x-0 bg-fg-muted',
            )}
          />
        </span>
      </span>
    </div>
  );
}
