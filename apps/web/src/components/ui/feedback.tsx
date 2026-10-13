import { clsx } from 'clsx';
import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';

export function VisuallyHidden({ children, ...rest }: ComponentPropsWithRef<'span'>) {
  return (
    <span className="sr-only" {...rest}>
      {children}
    </span>
  );
}

export function Skeleton({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-control bg-sunken', className)} {...rest} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mx-auto flex max-w-sm flex-col items-center px-4 py-12 text-center', className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 grid size-12 place-items-center rounded-full bg-dusk-soft text-dusk [&_svg]:size-5"
        >
          {icon}
        </div>
      )}
      <h2 className="font-serif text-xl font-normal text-fg">{title}</h2>
      {description && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

type CardProps<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithRef<T>,
  'as' | 'className' | 'children'
>;

export function Card<T extends ElementType = 'div'>({ as, className, children, ...rest }: CardProps<T>) {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag className={clsx('rounded-card border border-line bg-surface shadow-[var(--shadow-card)]', className)} {...rest}>
      {children}
    </Tag>
  );
}

export type ChipTone = 'default' | 'lamp' | 'dusk';

const chipTones: Record<ChipTone, { idle: string; selected: string }> = {
  default: { idle: 'border-line text-fg-muted', selected: 'border-fg-muted bg-sunken text-fg' },
  lamp: { idle: 'border-line text-fg-muted', selected: 'border-lamp/50 bg-lamp-soft text-lamp' },
  dusk: { idle: 'border-dusk/30 bg-dusk-soft text-dusk', selected: 'border-dusk bg-dusk-soft text-dusk' },
};

export type ChipProps = {
  selected?: boolean;
  onClick?: () => void;
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithRef<'button'>, 'onClick' | 'children'>;

export function Chip({ selected = false, onClick, tone = 'default', className, children, ...rest }: ChipProps) {
  const classes = clsx(
    'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap',
    selected ? chipTones[tone].selected : chipTones[tone].idle,
    className,
  );
  if (!onClick) return <span className={classes}>{children}</span>;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(classes, 'transition-colors hover:border-line-strong hover:text-fg')}
      {...rest}
    >
      {children}
    </button>
  );
}

