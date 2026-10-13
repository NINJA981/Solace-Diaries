/// <reference types="vite-plugin-pwa/vanillajs" />
import { useEffect } from 'react';
import { toast } from '@/components/ui/toast';

/**
 * Registers the service worker once the page has loaded and is idle (keeps workbox-window
 * out of the first-load path), and offers a reload when a new deploy is waiting.
 */
export function usePwaUpdatePrompt() {
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    const register = () => {
      void import('virtual:pwa-register').then(({ registerSW }) => {
        if (cancelled) return;
        const update = registerSW({
          onNeedRefresh() {
            toast('A new version of Solace is ready.', {
              id: 'sw-update',
              duration: 0,
              action: { label: 'Reload', onClick: () => void update(true) },
            });
          },
          onRegisterError() {
            /* offline install unavailable; the site still works */
          },
        });
      });
    };
    const onLoad = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(register, { timeout: 4000 }) : setTimeout(register, 2000));
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', onLoad);
    };
  }, []);
}
