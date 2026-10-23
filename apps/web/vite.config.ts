/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import themeColors from './src/worlds/theme-colors.json' with { type: 'json' };
import { DEFAULT_WORLD, themeInitScript } from './src/worlds/theme-init.ts';

const require = createRequire(import.meta.url);

// Absolute origin for social-card URLs in index.html (e.g. https://solace.example). Optional:
// without it the og:image URL is relative, which most (not all) link previews accept.
process.env.VITE_SITE_URL = (process.env.VITE_SITE_URL ?? '').replace(/\/+$/, '');
const fontDir = (pkg: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files');

const defaultColors = (themeColors as Record<string, { light: string; dark: string }>)[DEFAULT_WORLD]!;

/**
 * World + theme before first paint: serves and emits /theme-init.js (built from
 * src/worlds/theme-init.ts and theme-colors.json) and fills index.html's theme-color metas.
 * theme-colors.json is the one copy of each world's browser colour.
 */
function appearance(): Plugin {
  const script = themeInitScript();
  return {
    name: 'solace:appearance',
    configureServer(server) {
      server.middlewares.use('/theme-init.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(script);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'theme-init.js', source: script });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replaceAll('__SOLACE_THEME_DARK__', defaultColors.dark).replaceAll('__SOLACE_THEME_LIGHT__', defaultColors.light),
    },
  };
}

/** Preloads the two latin variable fonts the first paint needs (hashed names known only after bundling). */
function preloadFonts(): Plugin {
  const wanted = /(newsreader-latin-opsz-normal|instrument-sans-latin-wght-normal)-[\w-]+\.woff2$/;
  return {
    name: 'solace:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => wanted.test(file))
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadFonts(),
    appearance(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Solace',
        short_name: 'Solace',
        description: 'A private journal that remembers what matters to you.',
        start_url: '/app/today',
        scope: '/',
        display: 'standalone',
        background_color: defaultColors.dark,
        theme_color: defaultColors.dark,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell, code-split routes, styles, the default world's fonts and icons. Nothing else:
        // other worlds' fonts download when someone picks that world (then the HTTP cache keeps them).
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}', '**/{newsreader,instrument-sans}-*.woff2'],
        globIgnores: ['og.png', '**/*.map'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/],
        // Private data must never be cached: no runtime caching for the API (or anything else).
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@fonts/newsreader': fontDir('@fontsource-variable/newsreader'),
      '@fonts/instrument-sans': fontDir('@fontsource-variable/instrument-sans'),
      // Other worlds' fonts: registered lazily by each world's fonts.css (see manifest.loadFonts).
      '@fonts/fredoka': fontDir('@fontsource-variable/fredoka'),
      '@fonts/onest': fontDir('@fontsource-variable/onest'),
      '@fonts/playpen-sans': fontDir('@fontsource-variable/playpen-sans'),
      '@fonts/courier-prime': fontDir('@fontsource/courier-prime'),
      '@fonts/archivo': fontDir('@fontsource-variable/archivo'),
      '@fonts/martian-mono': fontDir('@fontsource-variable/martian-mono'),
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 0 },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/lib/test-setup.ts'],
  },
});
