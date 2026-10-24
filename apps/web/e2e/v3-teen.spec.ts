/**
 * Teen mode: age gate, parental consent flow, the parent's public page and the locked screen.
 * The API is mocked with page.route (fake user, fake tokens); nothing here is real data.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { profile } from './v3-fixtures';

const API = 'http://127.0.0.1:8787/api';
const USER = profile.id;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
    body: JSON.stringify(body),
  });

async function signIn(context: BrowserContext) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, email: profile.email, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
  const session = {
    access_token: token,
    refresh_token: 'fake-refresh',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: { id: USER, aud: 'authenticated', role: 'authenticated', email: profile.email, app_metadata: {}, user_metadata: {}, created_at: '2025-09-01T10:00:00Z' },
  };
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('sb-127-auth-token', value);
    } catch {
      /* storage unavailable */
    }
  }, JSON.stringify(session));
  await context.route('http://127.0.0.1:55321/**', (route) => json(route, {}));
}

type State = Partial<typeof profile> & { ageBand?: string };

/** A mutable fake API: `state` is the profile the server would return. */
async function mockApi(page: Page, state: State, onRequest?: (m: string, p: string, body: unknown) => unknown) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return json(route, {});
    const path = new URL(req.url()).pathname.replace('/api', '');
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* no body */
    }
    calls.push({ method: req.method(), path, body });
    const handled = await onRequest?.(req.method(), path, body);
    if (handled === undefined && path === '/me') return json(route, { ...profile, ...state });
    if (handled !== undefined) return json(route, handled);
    if (path === '/entries') return json(route, { items: [], nextCursor: null });
    return json(route, { error: `unmocked ${req.method()} ${path}`, code: 'not_found' }, 404);
  });
  return calls;
}

test.describe('age gate', () => {
  test('sends a signed-in person without an age to the gate, which has no axe violations', async ({ page, context }) => {
    await signIn(context);
    await mockApi(page, { ageConfirmed: false, onboardingDone: false });
    await page.goto('/app/today');
    await expect(page).toHaveURL(/\/age$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Before you start' })).toBeVisible();
    // nothing pre-selected, and only month + year are asked
    await expect(page.getByLabel('Month')).toHaveValue('');
    await expect(page.getByLabel('Year')).toHaveValue('');
    await expect(page.getByLabel(/day/i)).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });

  test('under 13: a kind explanation and the account is gone', async ({ page, context }) => {
    await signIn(context);
    await mockApi(page, { ageConfirmed: false });
    // 403 for the gate call (registered last, so it wins over the catch-all above)
    await page.route(`${API}/me/age`, (route) =>
      route.request().method() === 'OPTIONS' ? json(route, {}) : json(route, { error: 'Solace is for people aged 13 and over.', code: 'age_restricted' }, 403),
    );
    await page.goto('/age');
    await page.getByLabel('Month').selectOption('5');
    await page.getByLabel('Year').selectOption(String(new Date().getFullYear() - 10));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/age-restricted$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Solace is for ages 13 and up' })).toBeVisible();
    await expect(page.getByText('We haven’t kept anything.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('a teen answer shows the parent hint and moves to the consent screen', async ({ page, context }) => {
    await signIn(context);
    const state: State = { ageConfirmed: false, onboardingDone: false };
    await mockApi(page, state, (m, p) => {
      if (m === 'POST' && p === '/me/age') {
        Object.assign(state, { ageConfirmed: true, mode: 'teen', consentStatus: 'pending' });
        return { ...profile, ...state };
      }
    });
    await page.goto('/age');
    await page.getByLabel('Month').selectOption('12');
    await page.getByLabel('Year').selectOption(String(new Date().getFullYear() - 15));
    await expect(page.getByText('a parent or guardian will need to say yes')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/teen$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ask a parent or guardian' })).toBeVisible();
  });
});

test.describe('teen consent flow', () => {
  test('ask, wait, and get unlocked when the parent approves', async ({ page, context }) => {
    await signIn(context);
    const state: State = { ageConfirmed: true, mode: 'teen', consentStatus: 'pending', onboardingDone: true };
    const calls = await mockApi(page, state, (m, p) => {
      if (m === 'POST' && p === '/me/consent') return { sentTo: 'm•••@example.com', expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString() };
    });
    await page.goto('/app/today');
    await expect(page).toHaveURL(/\/teen$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ask a parent or guardian' })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByLabel('Parent or guardian’s email').fill('mum@example.com');
    await page.getByRole('button', { name: 'Send the email' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting for your parent' })).toBeVisible();
    await expect(page.getByText('m•••@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send it again in \d+s/ })).toBeDisabled();
    expect(calls.find((c) => c.path === '/me/consent')?.body).toEqual({ parentEmail: 'mum@example.com' });
    expect(await axe(page)).toEqual([]);

    // The parent approves; the next poll (here triggered by returning to the tab) unlocks the app.
    Object.assign(state, { consentStatus: 'granted' });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page).toHaveURL(/\/app\/today/, { timeout: 15_000 });
  });

  test('a declined or withdrawn approval shows the calm locked screen', async ({ page, context }) => {
    await signIn(context);
    await mockApi(page, { ageConfirmed: true, mode: 'teen', consentStatus: 'revoked', onboardingDone: true });
    await page.goto('/app/today');
    await expect(page).toHaveURL(/\/teen$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your journal is on hold' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download my journal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask a parent again' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('crisis help is reachable from the waiting screens', async ({ page, context }) => {
    await signIn(context);
    await mockApi(page, { ageConfirmed: true, mode: 'teen', consentStatus: 'pending', onboardingDone: true });
    await page.goto('/teen');
    await page.getByText('Need to talk to someone?').click();
    await expect(page.getByRole('link', { name: 'Call Tele-MANAS on 14416' })).toHaveAttribute('href', 'tel:14416');
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('the parent page', () => {
  const view = (status: string) => ({ teenFirstName: 'Alex', status, policyVersion: '2026-10', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });

  async function mockConsent(page: Page) {
    let status = 'pending';
    const calls: unknown[] = [];
    await page.route(`${API}/consent/tok_valid_0123456789abcdef`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return json(route, {});
      if (req.method() === 'GET') return json(route, view(status));
      const { decision } = req.postDataJSON() as { decision: string };
      calls.push(decision);
      status = decision === 'grant' ? 'granted' : decision === 'deny' ? 'denied' : 'revoked';
      return json(route, view(status));
    });
    await page.route(`${API}/consent/bad`, (route) =>
      route.request().method() === 'OPTIONS' ? json(route, {}) : json(route, { error: 'This link is not valid or has expired.', code: 'not_found' }, 404),
    );
    return calls;
  }

  test('explains Solace and lets a parent approve, then withdraw', async ({ page }) => {
    const calls = await mockConsent(page);
    await page.goto('/consent/tok_valid_0123456789abcdef');
    await expect(page.getByRole('heading', { level: 1, name: 'Alex would like to use Solace' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Who handles it' })).toBeVisible();
    await expect(page.getByText('Google Gemini').first()).toBeVisible();
    await expect(page.getByText(/free Gemini service|paid Gemini service/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Questions parents ask' })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Approve Alex’s account' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, approve' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'You approved Alex’s account' })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden(); // let the dialog finish fading before axe
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Withdraw approval' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw approval' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Approval withdrawn' })).toBeVisible();
    expect(calls).toEqual(['grant', 'revoke']);
  });

  test('declining asks for confirmation first', async ({ page }) => {
    const calls = await mockConsent(page);
    await page.goto('/consent/tok_valid_0123456789abcdef');
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Go back' }).click();
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, decline' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'You declined' })).toBeVisible();
    expect(calls).toEqual(['deny']);
  });

  test('an invalid or expired link gives one generic answer', async ({ page }) => {
    await mockConsent(page);
    await page.goto('/consent/bad');
    await expect(page.getByRole('heading', { level: 1, name: 'This link isn’t working' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});
