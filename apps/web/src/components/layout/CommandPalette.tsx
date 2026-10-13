import { Command } from 'cmdk';
import { LogOut, Moon, Search, Settings, SquarePen, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { supportsClosedBy } from '@/components/ui/Dialog';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { NAV_ITEMS, NEW_ENTRY_PATH } from './nav';

export const OPEN_PALETTE_EVENT = 'solace:open-palette';

/** Opens the palette from anywhere (buttons in the rail/header dispatch this). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * ⌘K / Ctrl+K command palette: new entry, jump to a destination, search the journal,
 * toggle theme, sign out. Rendered in a native modal <dialog> (inert background, Esc).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { signOut } = useSession();
  const { resolved, toggle } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal?.();
      // showModal() hands focus to the first focusable node (cmdk's root); the search field should have it.
      dialog.querySelector<HTMLInputElement>('[cmdk-input]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close?.();
      setSearch('');
      if (returnTo.current?.isConnected) returnTo.current.focus();
    }
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    // Let the dialog close (and focus return) before navigating, so route focus wins.
    requestAnimationFrame(action);
  };

  const query = search.trim();

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command menu"
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      {...{ closedby: 'any' }}
      onClick={(e) => {
        if (supportsClosedBy() || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) setOpen(false);
      }}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg overflow-visible rounded-sheet border border-line bg-raised p-0 text-fg shadow-[0_40px_90px_-30px_rgb(5_8_20/0.8)] backdrop:bg-ink/70 backdrop:backdrop-blur-[2px] open:animate-[dialog-in_160ms_ease-out]"
    >
      {open && (
        <Command label="Command menu" loop>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-fg-faint" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Search your journal or jump to…"
              className="h-14 w-full bg-transparent text-base text-fg placeholder:text-fg-faint focus:outline-none"
            />
            <kbd className="hidden rounded-[5px] border border-line px-1.5 py-0.5 text-xs text-fg-faint sm:block">Esc</kbd>
          </div>
          <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-2">
            <Command.Empty>Nothing matches. Try a different word.</Command.Empty>
            {query && (
              <Command.Group heading="Search" forceMount>
                <Command.Item
                  forceMount
                  value={`search-journal ${query}`}
                  onSelect={() => run(() => navigate(`/app/journal?q=${encodeURIComponent(query)}`))}
                >
                  <Search aria-hidden="true" />
                  <span className="truncate">
                    Search your journal for <span className="text-fg">“{query}”</span>
                  </span>
                </Command.Item>
              </Command.Group>
            )}
            <Command.Group heading="Write">
              <Command.Item value="New entry" keywords={['write', 'create', 'today']} onSelect={() => run(() => navigate(NEW_ENTRY_PATH))}>
                <SquarePen aria-hidden="true" />
                New entry
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Go to">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <Command.Item key={to} value={`Go to ${label}`} onSelect={() => run(() => navigate(to))}>
                  <Icon aria-hidden="true" />
                  {label}
                </Command.Item>
              ))}
              <Command.Item value="Go to Settings" keywords={['preferences', 'account', 'export', 'key']} onSelect={() => run(() => navigate('/app/settings'))}>
                <Settings aria-hidden="true" />
                Settings
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Preferences">
              <Command.Item value="Toggle theme" keywords={['dark', 'light', 'appearance']} onSelect={() => run(toggle)}>
                {resolved === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                Switch to {resolved === 'dark' ? 'light' : 'dark'} theme
              </Command.Item>
              <Command.Item value="Sign out" keywords={['log out', 'logout']} onSelect={() => run(() => void signOut())}>
                <LogOut aria-hidden="true" />
                Sign out
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      )}
    </dialog>
  );
}
