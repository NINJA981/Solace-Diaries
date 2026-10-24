/**
 * Live production check (opt-in): runs against the deployed site with real Supabase,
 * Render and Gemini. Needs LIVE_BASE_URL, LIVE_SUPABASE_URL and LIVE_SUPABASE_SECRET_KEY.
 * It creates one pre-confirmed throwaway user with the admin API (no emails are sent)
 * and deletes that account through the UI at the end.
 */
import { expect, test } from '@playwright/test';

const BASE = process.env.LIVE_BASE_URL;
const SUPABASE_URL = process.env.LIVE_SUPABASE_URL;
const SECRET = process.env.LIVE_SUPABASE_SECRET_KEY;
const PASSWORD = 'lamplight-and-ink-2026';

test.skip(!BASE || !SUPABASE_URL || !SECRET, 'live check is opt-in');
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE, timezoneId: 'Asia/Kolkata' });

test('live: sign in, write, real AI enrichment, search, Reflect, delete account', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  const email = `live-check-${Date.now()}@solace.invalid`;

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET!, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  expect(created.status, 'admin user creation').toBe(200);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });

  await test.step('cold start: the free API may need to wake up', async () => {
    const res = await page.request.get(`${process.env.LIVE_API_URL}/api/healthz`, { timeout: 90_000 });
    expect(res.ok()).toBe(true);
  });

  await test.step('sign in and onboard', async () => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The age gate comes first (an adult answer: 1990).
    await expect(page).toHaveURL(/\/age$/, { timeout: 30_000 });
    await page.getByLabel('Month').selectOption('6');
    await page.getByLabel('Year').selectOption('1990');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Your name' }).fill('Live Check');
    await page.getByRole('button', { name: 'Continue' }).click(); // name
    await page.getByRole('button', { name: 'Continue' }).click(); // world
    await page.getByRole('button', { name: 'Continue' }).click(); // day
    await page.getByRole('button', { name: 'Start writing' }).click();
    await expect(page).toHaveURL(/\/app\/today$/);
  });

  const title = 'Harbour at dusk';
  await test.step('write an entry; it saves', async () => {
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page
      .getByRole('textbox', { name: 'Entry', exact: true })
      .fill(
        'Walked down to the harbour with Maya after work and watched the ferries come in. ' +
          'The light was soft and for the first time this week I felt calm. ' +
          'Dad called while we were sitting on the wall; I keep saying I will visit him before winter.',
      );
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 30_000 });
  });

  await test.step('real Gemini enrichment produces Solace’s note', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal', exact: true }).click();
    await page.getByRole('link', { name: title }).first().click();
    const note = page.getByRole('complementary', { name: 'Solace’s note' });
    await expect(note).toBeVisible({ timeout: 120_000 });
    console.log(`enrichment note: ${(await note.innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  });

  await test.step('search by meaning finds it; an off-topic query does not', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search your journal' });
    const results = page.getByRole('region', { name: 'Search results' });
    await search.fill('when did I feel peaceful by the water');
    await search.press('Enter');
    await page.getByRole('tab', { name: 'By meaning' }).click();
    await expect(results.getByRole('link', { name: title })).toBeVisible({ timeout: 30_000 });
    await search.fill('quantum physics homework');
    await search.press('Enter');
    await expect(results.getByRole('link', { name: title })).toHaveCount(0, { timeout: 30_000 });
  });

  await test.step('Reflect answers from the journal with a citation', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reflect', exact: true }).click();
    const ask = page.getByRole('textbox', { name: 'Ask about your journal' });
    await ask.fill('Who did I go to the harbour with?');
    await ask.press('Enter');
    await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({ timeout: 90_000 });
    const answer = await page.locator('main').innerText();
    console.log(`reflect mentions Maya: ${/Maya/.test(answer)}`);
    await expect(page.getByRole('region', { name: 'From your journal' }).last().getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await page.screenshot({ path: '../../.tmp/screens/live-reflect.png' });
  });

  await test.step('delete the account through Settings', async () => {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account and journal?' });
    await dialog.getByRole('textbox', { name: `Type ${email} to confirm` }).fill(email);
    await dialog.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'A private journal that remembers.' })).toBeVisible({ timeout: 30_000 });
  });

  expect(problems, problems.join('\n')).toEqual([]);
});

test.afterAll(async () => {
  // Safety net: if a step failed before the UI deletion, remove throwaway accounts via the API.
  if (!SUPABASE_URL || !SECRET) return;
  const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };
  const list = (await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: admin }).then((r) =>
    r.json(),
  )) as { users: { id: string; email: string }[] };
  for (const u of list.users.filter((x) => x.email.startsWith('live-check-'))) {
    const login = (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    }).then((r) => r.json())) as { access_token?: string };
    if (!login.access_token) continue;
    await fetch(`${process.env.LIVE_API_URL}/api/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: u.email }),
    });
  }
});
