import { clsx } from 'clsx';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

type FieldProps = { label?: string; hint?: ReactNode; error?: string };

const control =
  'w-full rounded-control border border-control-edge bg-sunken text-fg placeholder:text-fg-faint ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-fg-muted focus:border-lamp focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger';

function useField(id: string | undefined, hint: ReactNode | undefined, error: string | undefined) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { fieldId, hintId, errorId, describedBy };
}

function FieldShell({
  fieldId,
  label,
  hint,
  hintId,
  error,
  errorId,
  className,
  children,
}: FieldProps & { fieldId: string; hintId?: string; errorId?: string; className?: string; children: ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={fieldId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-snug text-fg-muted">
          {hint}
        </p>
      )}
      {hint && error && (
        <p id={hintId} className="sr-only">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs leading-snug font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export type InputProps = ComponentPropsWithRef<'input'> & FieldProps & { containerClassName?: string };

export function Input({ label, hint, error, id, className, containerClassName, ...rest }: InputProps) {
  const { fieldId, hintId, errorId, describedBy } = useField(id, hint, error);
  return (
    <FieldShell {...{ fieldId, label, hint, hintId, error, errorId }} className={containerClassName}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(control, 'h-10 px-3 text-base', className)}
        {...rest}
      />
    </FieldShell>
  );
}

export type TextareaProps = ComponentPropsWithRef<'textarea'> & FieldProps & { containerClassName?: string };

export function Textarea({ label, hint, error, id, className, containerClassName, rows = 4, ...rest }: TextareaProps) {
  const { fieldId, hintId, errorId, describedBy } = useField(id, hint, error);
  return (
    <FieldShell {...{ fieldId, label, hint, hintId, error, errorId }} className={containerClassName}>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(control, 'px-3 py-2.5 text-base leading-relaxed', className)}
        {...rest}
      />
    </FieldShell>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'children'> &
  FieldProps & { options: SelectOption[]; containerClassName?: string };

export function Select({ label, hint, error, id, options, className, containerClassName, ...rest }: SelectProps) {
  const { fieldId, hintId, errorId, describedBy } = useField(id, hint, error);
  return (
    <FieldShell {...{ fieldId, label, hint, hintId, error, errorId }} className={containerClassName}>
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(control, 'h-10 appearance-none pr-9 pl-3 text-base', className)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    </FieldShell>
  );
}
