/**
 * Appearance on this device: the world (lamplight, jelly, …) and the theme preference
 * (light / dark / system). public/theme-init.js (generated from src/worlds/theme-init.ts) applies
 * both before first paint; this module keeps them applied afterwards and lets React subscribe.
 *
 *   <html data-world="lamplight" data-theme="dark">   theme is always resolved, never absent
 *
 *   useTheme()        { theme, resolved, setTheme, toggle }       device only
 *   useDeviceWorld()  the world on this device (public pages, voice, hero)
 *   setDeviceWorld()  switch worlds here; signed-in code uses useWorld() (lib/world.ts), which
 *                     also saves the choice to the profile
 *
 * Entry-chunk safe: no API client, no zod.
 */
import { useCallback, useSyncExternalStore } from 'react';
import themeColors from '@/worlds/theme-colors.json';
import { DEFAULT_WORLD, THEME_STORAGE_KEY, WORLD_STORAGE_KEY } from '@/worlds/theme-init';
import type { WorldId } from '@/worlds/types';

export { THEME_STORAGE_KEY, WORLD_STORAGE_KEY };
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const COLORS = themeColors as Record<string, Record<ResolvedTheme, string>>;
export const WORLD_IDS = Object.keys(COLORS) as WorldId[];

export function isWorldId(value: unknown): value is WorldId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLORS, value);
}

/** Browser UI colour (meta theme-color) for a world and theme. */
export function themeColor(world: WorldId, theme: ResolvedTheme): string {
  return (COLORS[world] ?? COLORS[DEFAULT_WORLD]!)[theme];
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* not remembered; still applied for this visit */
  }
}

export function readTheme(): ThemePreference {
  const value = read(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readWorld(): WorldId {
  const value = read(WORLD_STORAGE_KEY);
  return isWorldId(value) ? value : (DEFAULT_WORLD as WorldId);
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' ? !matchMedia('(prefers-color-scheme: light)').matches : true;
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref;
  return systemPrefersDark() ? 'dark' : 'light';
}

let theme: ThemePreference | null = null;
let world: WorldId | null = null;
const current = () => ({ theme: (theme ??= readTheme()), world: (world ??= readWorld()) });

/** Writes the world, the resolved theme and the browser colours onto <html>. */
export function applyAppearance(root: HTMLElement = document.documentElement): void {
  const { theme: pref, world: w } = current();
  root.setAttribute('data-world', w);
  root.setAttribute('data-theme', resolveTheme(pref));
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (scheme) scheme.content = pref === 'system' ? 'light dark' : pref;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const forTheme: ResolvedTheme = pref !== 'system' ? pref : (meta.getAttribute('media') ?? '').includes('light') ? 'light' : 'dark';
    meta.content = themeColor(w, forTheme);
  });
}

/** Kept for callers that only think about the theme. */
export function applyTheme(pref: ThemePreference, root?: HTMLElement): void {
  theme = pref;
  applyAppearance(root);
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function setTheme(pref: ThemePreference): void {
  write(THEME_STORAGE_KEY, pref === 'system' ? null : pref);
  theme = pref;
  applyAppearance();
  emit();
}

/** Switches the world on this device only (no profile write). Attribute swap: nothing flashes. */
export function setDeviceWorld(next: WorldId): void {
  if (!isWorldId(next)) return;
  write(WORLD_STORAGE_KEY, next === DEFAULT_WORLD ? null : next);
  world = next;
  applyAppearance();
  emit();
}

let initialised = false;
/**
 * Once at startup (main.tsx): re-applies the stored appearance (in case the pre-paint script
 * couldn't run) and keeps it right when the OS scheme flips or another tab changes it.
 */
export function initAppearance(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  applyAppearance();
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  mq?.addEventListener('change', () => {
    if (current().theme !== 'system') return;
    applyAppearance();
    emit();
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== WORLD_STORAGE_KEY && e.key !== null) return;
    theme = readTheme();
    world = readWorld();
    applyAppearance();
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Components that care about the OS scheme also hear it directly (tests mount without init).
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  mq?.addEventListener('change', listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === WORLD_STORAGE_KEY) {
      theme = readTheme();
      world = readWorld();
      applyAppearance();
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

function themeSnapshot(): string {
  const { theme: pref } = current();
  return `${pref}:${resolveTheme(pref)}`;
}

export function useTheme(): {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
  toggle: () => void;
} {
  const snap = useSyncExternalStore(subscribe, themeSnapshot, () => 'system:dark');
  const [pref, resolved] = snap.split(':') as [ThemePreference, ResolvedTheme];
  // Two-state toggle: flip what's on screen; if that lands on the device's own scheme, go back
  // to following the device instead of pinning it.
  const toggle = useCallback(() => {
    const target = resolved === 'dark' ? 'light' : 'dark';
    setTheme(target === resolveTheme('system') ? 'system' : target);
  }, [resolved]);
  return { theme: pref, resolved, setTheme, toggle };
}

/** The world on this device; re-renders when it changes (here or in another tab). */
export function useDeviceWorld(): WorldId {
  return useSyncExternalStore(subscribe, () => current().world, () => DEFAULT_WORLD as WorldId);
}

/** Test helper: forget cached values so the next read comes from storage again. */
export function resetAppearanceForTests(): void {
  theme = null;
  world = null;
}
