import { clsx } from 'clsx';
import { Check, LogOut, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useProfile, useSession } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = (name.trim()[0] ?? '·').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'grid size-8 shrink-0 place-items-center rounded-full bg-lamp-soft font-serif text-base text-lamp ring-1 ring-lamp/25',
        className,
      )}
    >
      {initial}
    </span>
  );
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Account menu (menu button pattern): Settings, theme, sign out. `placement` opens it
 * above the trigger in the desktop rail and below it in the mobile header.
 */
export function AccountMenu({ placement = 'bottom', showIdentity = false }: { placement?: 'top' | 'bottom'; showIdentity?: boolean }) {
  const [open, setOpen] = useState(false);
  const { profile } = useProfile();
  const { email, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = profile?.displayName || email || 'You';

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const item =
    'flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-fg-muted outline-none ' +
    'hover:bg-sunken hover:text-fg focus-visible:bg-sunken focus-visible:text-fg focus-visible:outline-none [&_svg]:size-4';

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={showIdentity ? undefined : `Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-3 rounded-control text-left transition-colors hover:bg-sunken',
          showIdentity ? 'w-full p-2' : 'p-1',
        )}
      >
        <Avatar name={name} />
        {showIdentity && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{name}</span>
            {email && email !== name && <span className="block truncate text-xs text-fg-faint">{email}</span>}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onKeyDown}
          className={clsx(
            'absolute z-50 w-60 rounded-card border border-line bg-raised p-1.5 shadow-[0_24px_48px_-24px_rgb(5_8_20/0.8)]',
            'animate-[fade-in_120ms_ease-out]',
            placement === 'top' ? 'bottom-full left-0 mb-2' : 'top-full right-0 mt-2',
          )}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item}
            onClick={() => {
              close(false);
              navigate('/app/settings');
            }}
          >
            <Settings aria-hidden="true" /> Settings
          </button>
          <div role="group" aria-label="Theme" className="my-1 border-y border-line py-1">
            <p aria-hidden="true" className="px-3 pt-1.5 pb-1 text-xs text-fg-faint">
              Theme
            </p>
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.value}
                tabIndex={-1}
                className={item}
                onClick={() => setTheme(t.value)}
              >
                <span className="grid size-4 place-items-center">{theme === t.value && <Check aria-hidden="true" />}</span>
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item}
            onClick={() => {
              close(false);
              void signOut();
            }}
          >
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
