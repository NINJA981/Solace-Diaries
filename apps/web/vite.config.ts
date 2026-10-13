/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

// Absolute origin for social-card URLs in index.html (e.g. https://solace.example). Optional:
// without it the og:image URL is relative, which most (not all) link previews accept.
process.env.VITE_SITE_URL = (process.env.VITE_SITE_URL ?? '').replace(/\/+$/, '');
const fontDir = (pkg: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files');

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
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme-init.js'],
      manifest: {
        id: '/',
        name: 'Solace',
        short_name: 'Solace',
        description: 'A private journal that remembers what matters to you.',
        start_url: '/app/today',
        scope: '/',
        display: 'standalone',
        background_color: '#131a2c',
        theme_color: '#131a2c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell, code-split routes, styles, fonts and icons. Nothing else.
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,webmanifest}'],
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
