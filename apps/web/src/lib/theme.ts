/**
 * Theme preference: light / dark / system, stored per device. `system` removes
 * `data-theme` so tokens.css follows prefers-color-scheme. public/theme-init.js applies the
 * stored value before first paint; this module keeps it in sync afterwards.
 */
import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'solace.theme';
export const THEME_COLORS = { dark: '#131a2c', light: '#f4f3f8' } as const;

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' ? !matchMedia('(prefers-color-scheme: light)').matches : true;
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (scheme) scheme.content = pref === 'system' ? 'light dark' : pref;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    if (pref === 'system') {
      const dark = (meta.getAttribute('media') ?? '').includes('dark');
      meta.content = dark ? THEME_COLORS.dark : THEME_COLORS.light;
    } else {
      meta.content = THEME_COLORS[pref];
    }
  });
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function setTheme(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* not remembered, still applied for this visit */
  }
  current = pref;
  applyTheme(pref);
  emit();
}

let current: ThemePreference | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  mq?.addEventListener('change', listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      current = readTheme();
      applyTheme(current);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener('change', listener);
    window.removeEventListener('storage', onStorage);
  };
}

function snapshot(): string {
  current ??= readTheme();
  return `${current}:${resolveTheme(current)}`;
}

export function useTheme(): {
  theme: ThemePreference;
  resolved: 'light' | 'dark';
  setTheme: (pref: ThemePreference) => void;
  toggle: () => void;
} {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'system:dark');
  const [theme, resolved] = snap.split(':') as [ThemePreference, 'light' | 'dark'];
  // Two-state toggle: flip what's on screen; if that lands on the device's own scheme, go back
  // to following the device instead of pinning it.
  const toggle = useCallback(() => {
    const target = resolved === 'dark' ? 'light' : 'dark';
    setTheme(target === resolveTheme('system') ? 'system' : target);
  }, [resolved]);
  return { theme, resolved, setTheme, toggle };
}
