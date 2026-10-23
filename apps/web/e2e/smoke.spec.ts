import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** The production CSP from vercel.json, applied to documents so violations surface here. */
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const csp = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy')!
  .value.replace('upgrade-insecure-requests', '');

async function withCsp(page: Page) {
  const violations: string[] = [];
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('landing', () => {
  for (const scheme of ['dark', 'light'] as const) {
    test(`renders and has no axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const violations = await withCsp(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'A private journal that remembers.' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Start your journal' }).first()).toHaveAttribute('href', '/signup');
      await expect(page.locator('.remembering')).toHaveAttribute('data-phase', 'done');
      expect(await axe(page)).toEqual([]);
      expect(violations).toEqual([]);
    });
  }

  test('plays the constellation once and settles', async ({ page }) => {
    await page.goto('/');
    const scene = page.locator('.remembering');
    await expect(scene).toHaveAttribute('data-phase', 'done', { timeout: 10_000 });
  });

  test('legal pages render', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms' })).toBeVisible();
  });
});

test.describe('auth gate', () => {
  test('signed-out visitors to /app are sent to sign in, keeping their destination', async ({ page }) => {
    await page.goto('/app/journal?q=lake');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fjournal%3Fq%3Dlake$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  test('/app redirects to /login when signed out', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  for (const path of ['/login', '/signup', '/reset']) {
    test(`${path} has no axe violations`, async ({ page }) => {
      const violations = await withCsp(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(violations).toEqual([]);
    });
  }

  test('unknown pages show a helpful 404', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'There’s no page here' })).toBeVisible();
  });
});

/** Every world × theme: the public pages render in that world before first paint and pass axe. */
const WORLD_COLORS = JSON.parse(readFileSync(new URL('../src/worlds/theme-colors.json', import.meta.url), 'utf8')) as Record<
  string,
  { light: string; dark: string }
>;

async function severeAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const hex = (rgb: string) =>
  '#' +
  (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('');

test.describe('worlds', () => {
  for (const world of Object.keys(WORLD_COLORS)) {
    for (const scheme of ['dark', 'light'] as const) {
      test(`${world} (${scheme}): landing and auth pages pass axe`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.addInitScript((w) => {
          try {
            localStorage.setItem('solace.world', w);
          } catch {
            /* ignore */
          }
        }, world);
        const violations = await withCsp(page);
        for (const path of ['/', '/login', '/signup', '/reset']) {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          // Applied before first paint by theme-init.js: the right world, theme and canvas.
          await expect(page.locator('html')).toHaveAttribute('data-world', world);
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
          const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          expect(hex(canvas)).toBe(WORLD_COLORS[world]![scheme]);
          expect(await severeAxe(page), `${world}/${scheme} ${path}`).toEqual([]);
        }
        expect(violations).toEqual([]);
      });
    }
  }
});
