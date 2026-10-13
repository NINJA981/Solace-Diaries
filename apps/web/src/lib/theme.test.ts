import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, applyTheme, readTheme, setTheme, useTheme } from './theme';

import initScript from '../../public/theme-init.js?raw';

function mockSystem(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? light : !light,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
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
    new Function(initScript)();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content).toBe('light');
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => expect(m.content).toBe('#f4f3f8'));
  });

  it('follows the OS when nothing (or junk) is stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '<script>');
    new Function(initScript)();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => new Function(initScript)()).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('theme module', () => {
  it('stores explicit choices and clears the key for system', () => {
    setTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(readTheme()).toBe('system');
  });

  it('restores per-scheme theme-color metas when returning to system', () => {
    applyTheme('dark');
    applyTheme('system');
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    expect(metas.map((m) => m.content)).toEqual(['#131a2c', '#f4f3f8']);
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
});
