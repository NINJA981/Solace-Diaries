/**
 * The pre-paint script, served as /theme-init.js. vite.config.ts builds it from this source and
 * theme-colors.json (the one copy of each world's canvas colour), so the browser's theme colour,
 * the PWA manifest and this script can never drift apart.
 *
 * It runs as a blocking classic script in <head> (the CSP allows same-origin scripts only, so it
 * can't be inline): it reads the saved world and theme, then sets `data-world` and `data-theme`
 * on <html> (system preference resolved to light or dark) and the theme-color metas, before the
 * first paint. Keep it ES2019 and dependency-free; it must never throw.
 */
import themeColors from './theme-colors.json' with { type: 'json' };

export const WORLD_STORAGE_KEY = 'solace.world';
export const THEME_STORAGE_KEY = 'solace.theme';
export const DEFAULT_WORLD = 'lamplight';

export type ThemeColorMap = Record<string, { light: string; dark: string }>;

export function themeInitScript(colors: ThemeColorMap = themeColors, fallback: string = DEFAULT_WORLD): string {
  return `// Applies the saved world and theme before first paint. Generated from src/worlds/theme-init.ts.
(function (colors, fallback) {
  var root = document.documentElement;
  var world = fallback;
  var pref = null;
  try {
    var w = localStorage.getItem(${JSON.stringify(WORLD_STORAGE_KEY)});
    if (w && Object.prototype.hasOwnProperty.call(colors, w)) world = w;
    var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (t === 'light' || t === 'dark') pref = t;
  } catch (e) {
    /* storage blocked: the default world, following the OS */
  }
  var theme = pref;
  if (!theme) {
    try {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      theme = 'dark';
    }
  }
  root.setAttribute('data-world', world);
  root.setAttribute('data-theme', theme);
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme && pref) scheme.setAttribute('content', pref);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    var media = metas[i].getAttribute('media') || '';
    var forTheme = pref || (media.indexOf('light') >= 0 ? 'light' : 'dark');
    metas[i].setAttribute('content', colors[world][forTheme]);
  }
})(${JSON.stringify(colors)}, ${JSON.stringify(fallback)});
`;
}
