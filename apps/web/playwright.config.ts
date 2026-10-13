import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * apps/web/.env (if present), so the preview build talks to the same local stack as `vite dev`.
 * Real environment variables still win.
 */
function dotenv(): Record<string, string> {
  const file = new URL('./.env', import.meta.url);
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const fileEnv = dotenv();
const env = (key: string, fallback: string) => process.env[key] ?? fileEnv[key] ?? fallback;

const PORT = 4173;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Optional: run on an installed browser (e.g. PW_CHANNEL=chrome) instead of Playwright's bundled one.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // A production build, served the way users get it. The journey spec needs the real local
        // stack (API on :8787, Supabase on :55321), read from apps/web/.env or the environment.
        command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          VITE_API_URL: env('VITE_API_URL', 'http://127.0.0.1:8787'),
          VITE_SUPABASE_URL: env('VITE_SUPABASE_URL', 'http://127.0.0.1:55321'),
          VITE_SUPABASE_ANON_KEY: env('VITE_SUPABASE_ANON_KEY', 'e2e-placeholder-anon-key'),
        },
      },
});
