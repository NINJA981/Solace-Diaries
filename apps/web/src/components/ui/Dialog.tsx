import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/errors';
import { Button, IconButton } from './Button';

/** `<dialog closedby>` light-dismiss support (Chrome/Edge 134+, Firefox 141+). */
export function supportsClosedBy(): boolean {
  return typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
}

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Close when the backdrop is clicked (default true). */
  dismissible?: boolean;
};

/**
 * Native <dialog> opened with showModal(): the rest of the page is inert (a real focus
 * trap), Esc closes, and focus returns to whatever opened it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  // Restore focus once the dialog is gone.
  useEffect(() => {
    if (open) return;
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      // Light dismiss: native `closedby` where supported, a backdrop-click fallback elsewhere (Safari).
      {...{ closedby: dismissible ? 'any' : 'closerequest' }}
      onClick={(e) => {
        if (!dismissible || supportsClosedBy() || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
        if (!inside) onOpenChange(false);
      }}
      className={clsx(
        'm-auto w-[calc(100%-2rem)] max-w-md overflow-visible rounded-sheet border border-line bg-raised p-0 text-fg',
        'shadow-[0_30px_80px_-30px_rgb(5_8_20/0.7)] backdrop:bg-ink/75 backdrop:backdrop-blur-[2px]',
        'open:animate-[dialog-in_180ms_ease-out]',
        className,
      )}
    >
      {open && (
        <div className="flex flex-col">
          <div className="flex items-start gap-4 px-6 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-serif text-xl leading-tight font-normal text-fg">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton
              label="Close"
              icon={<X />}
              size="sm"
              className="-mt-1 -mr-2"
              onClick={() => onOpenChange(false)}
            />
          </div>
          {children && <div className="px-6 pt-4">{children}</div>}
          {footer ? (
            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>
          ) : (
            <div className="h-6" />
          )}
        </div>
      )}
    </dialog>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** May return a promise: the button shows progress, errors are shown inline. */
  onConfirm: () => void | Promise<void>;
  /** Extra content, e.g. a "type your email to confirm" field. */
  children?: ReactNode;
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  children,
  confirmDisabled,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Clear a stale error each time the dialog opens (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={pending}
            disabled={confirmDisabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {(children || error) && (
        <div className="flex flex-col gap-3">
          {children}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
