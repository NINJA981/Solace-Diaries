import { useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router';
import { usePwaUpdatePrompt } from './pwa';
import type { RouteHandle } from './router';

const SITE_TITLE = 'Solace — a private journal that remembers';

function useDocumentTitle() {
  const matches = useMatches();
  let title: string | undefined;
  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined;
    if (handle?.title !== undefined) title = handle.title;
  }
  useEffect(() => {
    if (title === undefined) return;
    document.title = title ? `${title} – Solace` : SITE_TITLE;
  }, [title]);
}

/**
 * After client-side navigation, move focus to the new page's h1 so screen-reader and
 * keyboard users land at the top of the content (initial load keeps the browser default).
 */
function useRouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let frame = 0;
    let tries = 0;
    const tick = () => {
      const heading = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.setAttribute('data-route-focus', '');
        heading.focus({ preventScroll: true });
        // A modal still animating out keeps the page inert; try again until it has gone (but never
        // take focus back from something the person moved to meanwhile).
        const active = document.activeElement;
        const stuck = !active || active === document.body || !!active.closest('dialog');
        if (active === heading || !stuck || tries++ >= 90) return;
        frame = requestAnimationFrame(tick);
        return;
      }
      if (tries++ < 90) frame = requestAnimationFrame(tick);
      else document.getElementById('main')?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

export function RootLayout() {
  useDocumentTitle();
  useRouteFocus();
  usePwaUpdatePrompt();
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
