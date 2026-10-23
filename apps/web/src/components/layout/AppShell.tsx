import { localDate } from '@solace/shared';
import { clsx } from 'clsx';
import { Search, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { RequireAuth } from '@/app/guards';
import { prefetchPage } from '@/app/pages';
import { preloadToasts, toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { voiceNow } from '@/lib/voice';
import { AccountMenu } from './AccountMenu';
import { CommandPalette, isMac, openCommandPalette } from './CommandPalette';
import { Wordmark } from './Logo';
import { NAV_ITEMS, isActive } from './nav';
import { SkipLink } from './SkipLink';

function Rail() {
  const { pathname } = useLocation();
  const shortcut = isMac() ? '⌘K' : 'Ctrl K';
  return (
    // The column spans the whole document (so its edge runs the full page); the rail inside it stays put.
    <aside className="relative z-30 hidden border-r border-line bg-canvas md:block">
      <div className="sticky top-0 flex h-dvh flex-col overflow-y-auto">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Link to="/app/today" aria-label="Solace, go to Today" className="rounded-control">
            <Wordmark />
          </Link>
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search or jump to a page"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex h-9 w-full items-center gap-2.5 rounded-control border border-line bg-sunken px-3 text-sm text-fg-faint transition-colors hover:border-line-strong hover:text-fg-muted"
          >
            <Search aria-hidden="true" className="size-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="font-ui text-xs">{shortcut}</kbd>
          </button>
        </div>
        <nav aria-label="Main" className="mt-5 flex-1 px-3">
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    viewTransition
                    onPointerEnter={() => prefetchPage(item.to)}
                    onFocus={() => prefetchPage(item.to)}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'group flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors',
                      active ? 'bg-accent-soft font-medium text-fg' : 'text-fg-muted hover:bg-sunken hover:text-fg',
                    )}
                  >
                    <Icon aria-hidden="true" className={clsx('size-[18px]', active ? 'text-accent' : 'text-fg-faint group-hover:text-fg-muted')} />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-1 border-t border-line p-3">
          <NavLink
            to="/app/settings"
            viewTransition
            onPointerEnter={() => prefetchPage('/app/settings')}
            onFocus={() => prefetchPage('/app/settings')}
            className={({ isActive: on }) =>
              clsx(
                'flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors',
                on ? 'bg-accent-soft font-medium text-fg' : 'text-fg-muted hover:bg-sunken hover:text-fg',
              )
            }
          >
            <Settings aria-hidden="true" className="size-[18px] text-fg-faint" />
            Settings
          </NavLink>
          <AccountMenu placement="top" showIdentity />
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-md md:hidden">
      <Link to="/app/today" aria-label="Solace, go to Today" className="-my-2 rounded-control py-2">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search or jump to"
          className="grid size-11 place-items-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg"
        >
          <Search aria-hidden="true" className="size-5" />
        </button>
        <AccountMenu placement="bottom" />
      </div>
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                  viewTransition
                  onPointerEnter={() => prefetchPage(item.to)}
                  onFocus={() => prefetchPage(item.to)}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex h-16 flex-col items-center justify-center gap-1 text-xs transition-colors',
                  active ? 'font-medium text-accent' : 'text-fg-muted',
                )}
              >
                <Icon aria-hidden="true" className="size-[22px]" strokeWidth={active ? 2.1 : 1.7} />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const NUDGE_KEY = 'solace.nudgedOn';

/** The optional daily reminder: a gentle in-app nudge, once a day, only if nothing was written yet. */
function useReminderNudge() {
  const { profile } = useProfile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hour = profile?.reminderHour ?? null;
  const tz = profile?.timezone;

  useEffect(() => {
    if (hour === null || !tz) return;
    let cancelled = false;
    const check = async () => {
      const now = new Date();
      const today = localDate(now, tz);
      const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(NUDGE_KEY);
      } catch {
        /* ignore */
      }
      if (localHour < hour || seen === today || window.location.pathname.startsWith('/app/today')) return;
      try {
        const page = await api.listEntries({ query: { from: today, to: today, limit: 1 } });
        if (cancelled || page.items.length > 0) return;
      } catch {
        return;
      }
      try {
        localStorage.setItem(NUDGE_KEY, today);
      } catch {
        /* ignore */
      }
      toast(voiceNow().reminderToast, {
        id: 'reminder',
        action: { label: 'Write now', onClick: () => navigate('/app/today') },
      });
    };
    void check();
    const timer = setInterval(() => void check(), 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hour, tz, navigate, pathname]);
}

function Shell() {
  useReminderNudge();
  // Toasts animate in with motion/react; have that chunk ready before the first one.
  useEffect(() => preloadToasts(), []);
  return (
    <div className="min-h-dvh bg-canvas md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <SkipLink />
      <Rail />
      <div className="min-w-0">
        <MobileHeader />
        <main id="main" tabIndex={-1} className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
          <Outlet />
        </main>
      </div>
      <TabBar />
      <CommandPalette />
    </div>
  );
}

export default function AppShell() {
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  );
}
