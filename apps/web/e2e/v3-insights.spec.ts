/**
 * v3 Insights and Reflect features against a mocked API (no real stack needed):
 * Unwrapped, mood patterns, growth note, Threads, chapters, letters, guided reflections.
 *
 *   E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/v3-insights.spec.ts
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockV3, type Scenario } from './v3-fixtures';

test.use({ timezoneId: 'Europe/London', reducedMotion: 'reduce' });

async function setup(page: Page, sc: Scenario = {}) {
  await page.context().clock.setFixedTime(new Date('2026-10-14T14:00:00Z'));
  return mockV3(page, page.context(), sc);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const WORLDS = ['lamplight', 'jelly', 'chrome'] as const;

test.describe('Insights', () => {
  test('patterns, growth note and Threads check-in / undo', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/app/insights');
    await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();

    // Mood patterns: plain, non-causal wording; thin or tiny patterns are left out.
    const patterns = page.getByRole('region', { name: 'Mood patterns' });
    await expect(patterns.getByText('Days with walks were usually calmer and brighter than your usual.')).toBeVisible();
    await expect(patterns.getByText('Days with deadlines were usually a little heavier than your usual.')).toBeVisible();
    await expect(patterns.getByText('Days with family were often calmer and brighter than your usual.')).toBeVisible();
    await expect(patterns.getByText('misc')).toHaveCount(0);

    // Growth note with citation links.
    const growth = page.getByRole('region', { name: 'How you’ve grown' });
    await expect(growth.getByRole('link', { name: /Source 1: Lake walk before work/ }).first()).toBeVisible();
    await expect(growth.getByRole('link', { name: /Lake walk before work/ }).last()).toHaveAttribute('href', /\/app\/entries\//);

    // Threads: suggestion, then check in today and undo.
    const threads = page.getByRole('region', { name: 'Threads' });
    await expect(threads.getByText('Solace noticed you want to')).toBeVisible();
    const today = threads.getByRole('button', { name: 'Wednesday 14, today' });
    await expect(today).toHaveAttribute('aria-pressed', 'false');
    await today.click();
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(calls.find((c) => c.path.endsWith('/checkins') && c.method === 'POST')?.body).toEqual({ date: '2026-10-14' });
    await today.click();
    await expect(today).toHaveAttribute('aria-pressed', 'false');
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/checkins/2026-10-14'))).toBe(true);
    // Two days ago stays checked and nothing is marked as missed.
    await expect(threads.getByRole('button', { name: 'Monday 12' })).toHaveAttribute('aria-pressed', 'true');
    await expect(threads.getByText(/missed|failed|behind/i)).toHaveCount(0);

    // Adopt the suggestion carries the memory id.
    await threads.getByRole('button', { name: 'Add as a thread' }).click();
    await expect.poll(() => calls.find((c) => c.method === 'POST' && c.path === '/intentions')?.body).toMatchObject({ kind: 'goal', memoryId: expect.any(String) });
  });

  test('teen mode shows no counters', async ({ page }) => {
    await setup(page, { mode: 'teen' });
    await page.goto('/app/insights');
    await expect(page.getByRole('region', { name: 'Threads' }).getByRole('button', { name: 'Monday 12' })).toBeVisible();
    await expect(page.getByText(/of the last 7 days/)).toHaveCount(0);
  });

  for (const world of WORLDS) {
    test(`no serious axe violations (${world})`, async ({ page }) => {
      await setup(page, { world });
      await page.goto('/app/insights');
      await expect(page.getByRole('region', { name: 'Threads' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mood patterns' }).getByText(/usually calmer/).first()).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }
});

test.describe('Unwrapped', () => {
  test('walks the story with the keyboard and ends on the persona card, with no share button', async ({ page }) => {
    await setup(page);
    await page.goto('/app/insights');
    await page.getByRole('link', { name: /Your September, unwrapped/ }).click();
    await expect(page).toHaveURL(/\/app\/insights\/unwrapped\?period=month&at=2026-09/);
    const story = page.getByRole('region', { name: 'September 2026 Unwrapped' });
    await expect(story.getByText('24 entries in 18 days.')).toBeVisible();
    const labels = ['Totals', 'Moods', 'Themes', 'Streak', 'Rhythm', 'First and last', 'People', 'Highlight', 'Your persona'];
    for (let i = 1; i < labels.length; i++) {
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('group', { name: `${i + 1} of ${labels.length}: ${labels[i]}` })).toBeVisible();
    }
    await expect(story.getByRole('heading', { name: 'Night-owl processor' })).toBeVisible();
    await expect(page.getByRole('button', { name: /share/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /share/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Slide 5 of 9: Rhythm/ }).click();
    await expect(story.getByText('You wrote most around 9 pm.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('teen mode skips people and streak slides', async ({ page }) => {
    await setup(page, { mode: 'teen' });
    await page.goto('/app/insights/unwrapped?period=month&at=2026-09');
    await expect(page.getByRole('button', { name: /Slide \d+ of 7: Highlight/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /People/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Streak/ })).toHaveCount(0);
  });

  test('is a real modal: the app behind is inert, Escape in a picker does not leak, focus returns', async ({ page }) => {
    await setup(page);
    await page.goto('/app/insights');
    const entry = page.getByRole('link', { name: /Your September, unwrapped/ });
    await entry.focus();
    await entry.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Unwrapped/ });
    await expect(dialog).toBeVisible();
    // Nothing behind the story can be reached or read.
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !document.activeElement?.closest('#root'))).toBe(true);
    }
    expect(await axe(page)).toEqual([]);
    // Escape meant for the open month picker must not close the story.
    const picker = dialog.getByLabel('Month', { exact: true });
    await picker.focus();
    await picker.press('Escape');
    await expect(dialog).toBeVisible();
    // Escape from the story itself closes it and gives focus back.
    await dialog.getByRole('region').focus();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/app\/insights$/);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('link', { name: /Your September, unwrapped/ })).toBeVisible();
  });

  test('explains the minimum when there is not enough', async ({ page }) => {
    await setup(page, { unwrappedThin: true });
    await page.goto('/app/insights/unwrapped?period=month&at=2026-09');
    await expect(page.getByRole('heading', { name: 'Not enough entries yet' })).toBeVisible();
    await expect(page.getByText(/at least 5 entries/)).toBeVisible();
  });
});

test.describe('Chapters', () => {
  test('timeline, list fallback and refresh with polling', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/app/insights/chapters');
    const timeline = page.getByRole('region', { name: /Chapters timeline/ });
    await expect(timeline.getByRole('heading', { name: 'Lake season' })).toBeVisible();
    await expect(page.getByText(/enough since the last reading/)).toBeVisible();
    await page.getByText('Read as a list').click();
    await expect(page.locator('details ol').getByText('Settling in')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh chapters' }).click();
    await expect.poll(() => calls.some((c) => c.path === '/chapters/refresh')).toBe(true);
    await expect(page.getByText('Chapters updated')).toBeVisible({ timeout: 15_000 });
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('Letters', () => {
  test('lists letters with citations, writes this month’s and replies', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/app/reflect/letters');
    await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Source 1: Lake walk before work/ })).toBeVisible();
    await page.getByRole('button', { name: 'Write this month’s letter' }).click();
    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Write this month’s letter' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reply to past me' }).first().click();
    await page.getByLabel('Your reply').fill('Thank you. I did keep walking.');
    await page.getByRole('button', { name: 'Save reply' }).click();
    await expect(page.getByRole('link', { name: 'Read your reply to past you' })).toBeVisible();
    expect(calls.find((c) => c.path.endsWith('/reply'))?.body).toEqual({ body: 'Thank you. I did keep walking.' });
  });

  test('cannot write: disabled with an explanation', async ({ page }) => {
    await setup(page, { canWrite: false });
    await page.goto('/app/reflect/letters');
    await expect(page.getByRole('button', { name: 'Write this month’s letter' })).toBeDisabled();
    await expect(page.getByText(/at least 8 entries older than about three months/)).toBeVisible();
  });

  for (const code of ['ai_quota_exceeded', 'rate_limited'] as const) {
    test(`${code} copy does not blame the person`, async ({ page }) => {
      await setup(page, { letterError: code });
      await page.goto('/app/reflect/letters');
      await page.getByRole('button', { name: 'Write this month’s letter' }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('shared');
      await expect(alert).toContainText('Gemini key in Settings');
      await expect(alert.getByRole('link', { name: 'Open Settings' })).toBeVisible();
    });
  }
});

test.describe('Guided reflections', () => {
  test('picking a mode creates the thread with that mode and shows it in the header', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/app/reflect');
    await expect(page.getByRole('link', { name: /Letters from past you/ })).toHaveAttribute('href', '/app/reflect/letters');
    await page.getByLabel(/Gratitude/).check({ force: true });
    await page.getByRole('button', { name: /Begin gratitude/ }).click();
    await expect(page).toHaveURL(/\/app\/reflect\/00000000-0000-4000-8000-000000000900$/);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/threads')?.body).toEqual({ title: 'Gratitude', mode: 'gratitude' });
    await expect(page.locator('#reflect-title').locator('xpath=following-sibling::span').first()).toBeVisible();
  });

  for (const world of WORLDS) {
    test(`start screen has no serious axe violations (${world})`, async ({ page }) => {
      await setup(page, { world });
      await page.goto('/app/reflect');
      await expect(page.getByRole('group', { name: /How would you like to reflect/ })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }
});
