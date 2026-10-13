import { clsx } from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none ' +
  'rounded-control transition-[background-color,border-color,color,box-shadow,filter] duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-55 aria-busy:cursor-progress';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-lamp text-lamp-fg shadow-[0_1px_0_rgb(255_255_255/0.18)_inset] hover:brightness-[1.06] active:brightness-95',
  secondary: 'border border-line-strong bg-raised text-fg hover:border-fg-faint hover:bg-sunken',
  ghost: 'text-fg-muted hover:bg-sunken hover:text-fg',
  danger: 'bg-danger text-ink hover:brightness-[1.06] active:brightness-95',
};

// Below `sm` every control is at least 44px tall (touch). min-* so callers' larger heights still win.
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm max-sm:min-h-11',
  md: 'h-10 px-4 text-sm max-sm:min-h-11',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} decorative /> : icon}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  /** Required: becomes the accessible name and the tooltip. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function IconButton({ label, icon, variant = 'ghost', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        base,
        variants[variant],
        size === 'sm' ? 'size-8' : 'size-10',
        'max-sm:min-h-11 max-sm:min-w-11',
        '[&_svg]:size-[18px]',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
