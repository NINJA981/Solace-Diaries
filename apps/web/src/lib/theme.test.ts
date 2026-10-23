import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import themeColors from '@/worlds/theme-colors.json';
import { themeInitScript } from '@/worlds/theme-init';
import {
  THEME_STORAGE_KEY,
  WORLD_STORAGE_KEY,
  applyTheme,
  readTheme,
  readWorld,
  resetAppearanceForTests,
  setDeviceWorld,
  setTheme,
  useDeviceWorld,
  useTheme,
} from './theme';

const COLORS = themeColors as Record<string, { light: string; dark: string }>;
const initScript = themeInitScript();
const runInit = () => new Function(initScript)();

function mockSystem(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? light : !light,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const html = document.documentElement;
const metas = () => Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((m) => m.content);

beforeEach(() => {
  localStorage.clear();
  resetAppearanceForTests();
  html.removeAttribute('data-theme');
  html.removeAttribute('data-world');
  document.head.innerHTML = `
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#131a2c">
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f3f8">`;
  mockSystem(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('theme-init.js (runs before first paint)', () => {
  it('applies a stored explicit theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runInit();
    expect(html.dataset.theme).toBe('light');
    expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content).toBe('light');
    expect(metas()).toEqual([COLORS.lamplight!.light, COLORS.lamplight!.light]);
  });

  it('follows the OS when nothing (or junk) is stored, resolving it to light or dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '<script>');
    runInit();
    expect(html.dataset.theme).toBe('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content).toBe('light dark');
    mockSystem(true);
    runInit();
    expect(html.dataset.theme).toBe('light');
  });

  it('applies a stored world, with its own browser colours', () => {
    const other = Object.keys(COLORS).find((w) => w !== 'lamplight') ?? 'lamplight';
    localStorage.setItem(WORLD_STORAGE_KEY, other);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runInit();
    expect(html.dataset.world).toBe(other);
    expect(metas()).toEqual([COLORS[other]!.dark, COLORS[other]!.dark]);
  });

  it('falls back to the default world for unknown or hostile values', () => {
    for (const junk of ['nope', '__proto__', 'constructor', '"><img src=x>']) {
      localStorage.setItem(WORLD_STORAGE_KEY, junk);
      runInit();
      expect(html.dataset.world).toBe('lamplight');
    }
  });

  it('keeps per-scheme browser colours while following the OS', () => {
    runInit();
    expect(metas()).toEqual([COLORS.lamplight!.dark, COLORS.lamplight!.light]);
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(runInit).not.toThrow();
    expect(html.dataset.world).toBe('lamplight');
    expect(html.dataset.theme).toBe('dark');
    vi.restoreAllMocks();
  });

  it('embeds every world colour from theme-colors.json (the one source of truth)', () => {
    for (const [world, pair] of Object.entries(COLORS)) {
      expect(initScript).toContain(`"${world}":{"light":"${pair.light}","dark":"${pair.dark}"}`);
    }
  });
});

describe('theme module', () => {
  it('stores explicit choices and clears the key for system', () => {
    setTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    mockSystem(true);
    setTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    // System is resolved on the element (the device is light here), never left absent.
    expect(html.dataset.theme).toBe('light');
    expect(readTheme()).toBe('system');
  });

  it('restores per-scheme theme-color metas when returning to system', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(metas()).toEqual([COLORS.lamplight!.dark, COLORS.lamplight!.light]);
  });

  it('toggle flips what is on screen and returns to system when matching the device', () => {
    mockSystem(true); // device is light
    setTheme('system');
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggle());
    // Back to light = the device's own scheme: unpinned rather than stored.
    expect(result.current.theme).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('switches worlds on the device and tells subscribers', () => {
    const other = Object.keys(COLORS).find((w) => w !== 'lamplight');
    const { result } = renderHook(() => useDeviceWorld());
    expect(result.current).toBe('lamplight');
    if (!other) return;
    act(() => setDeviceWorld(other as never));
    expect(result.current).toBe(other);
    expect(html.dataset.world).toBe(other);
    expect(localStorage.getItem(WORLD_STORAGE_KEY)).toBe(other);
    act(() => setDeviceWorld('lamplight'));
    // The default world isn't stored: a fresh device and a Lamplight device look the same.
    expect(localStorage.getItem(WORLD_STORAGE_KEY)).toBeNull();
    expect(readWorld()).toBe('lamplight');
  });

  it('ignores unknown worlds', () => {
    setDeviceWorld('nope' as never);
    expect(readWorld()).toBe('lamplight');
  });
});
