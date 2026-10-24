/**
 * Time and memory, end to end, with no real API: Today with "Remember when" cards and the Sunday
 * review card, time capsules (validation, sealed rows show no body, the opening reveal) and the
 * weekly ritual. Every API call is answered by page.route, so this runs anywhere the web build does.
 *
 *   npx playwright test e2e/v3-time.spec.ts --project=desktop
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const USER = '7a0c6a52-6a2e-4b65-9a7a-0d6c1f6b2d11';
const SUNDAY = '2026-10-18T10:00:00Z'; // a Sunday in London
const TODAY = '2026-10-18';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const SEALED_SECRET = 'SECRET-sealed-body-must-never-render';
const READY_BODY = 'Dear me, I hope the flat feels like home by now. You were so nervous. It worked out.';

type MockCapsule = {
  id: string; title: string; body: string | null; unlockAt: string; status: 'sealed' | 'ready' | 'opened'; openedAt: string | null; createdAt: string;
};

const summary = (i: number, title: string, date: string) => ({
  id: uuid(i), title, excerpt: 'The water was flat as glass and I let my shoulders drop for a while.', entryDate: date, mood: 'calm',
  moodSource: 'user', tags: [], summary: null, wordCount: 40, version: 1, enrichmentStatus: 'ready',
  createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, attachmentCount: 0,
});

function profile(world: string, mode: 'adult' | 'teen' = 'adult') {
  return {
    id: USER, email: 'sam@example.com', displayName: 'Sam Rivera', timezone: 'Europe/London', onboardingDone: true, aiStyle: 'gentle',
    reminderHour: null, world, soundEnabled: false, hapticsEnabled: false, companionName: '', mode, ageConfirmed: true,
    consentStatus: mode === 'teen' ? 'granted' : 'not_required', createdAt: '2025-09-01T10:00:00.000Z',
  };
}

async function setup(page: Page, context: BrowserContext, world: string, opts: { mode?: 'adult' | 'teen' } = {}) {
  const capsules: MockCapsule[] = [
    { id: uuid(1), title: 'For the day I move', body: null, unlockAt: '2027-04-18T08:00:00.000Z', status: 'sealed', openedAt: null, createdAt: '2026-10-01T09:00:00.000Z' },
    { id: uuid(2), title: 'Before the interview', body: null, unlockAt: '2026-10-10T08:00:00.000Z', status: 'ready', openedAt: null, createdAt: '2026-04-01T09:00:00.000Z' },
  ];
  const calls: { createCapsule: unknown[]; ritual: unknown[] } = { createCapsule: [], ritual: [] };
  const exp = 4_102_444_800; // 2100
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, email: 'sam@example.com', aud: 'authenticated', role: 'authenticated', exp })}.sig`;
  await context.addInitScript(
    ([k, v, w]) => {
      try {
        localStorage.setItem(k!, v!);
        localStorage.setItem('solace.world', w!);
      } catch {
        /* ignore */
      }
    },
    [
      'sb-127-auth-token',
      JSON.stringify({
        access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 9e7, expires_at: exp,
        user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'sam@example.com', app_metadata: {}, user_metadata: {}, created_at: '2025-09-01T10:00:00Z' },
      }),
      world,
    ],
  );
  await context.route('**/127.0.0.1:55321/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  const json = (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return json(route, {});
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const m = req.method();
    if (p === '/me') return json(route, profile(world, opts.mode));
    if (p === '/entries' && m === 'GET') return json(route, { items: [], nextCursor: null });
    if (p === '/insights/stats') {
      return json(route, { today: TODAY, days: [], currentStreak: 4, longestStreak: 9, totalEntries: 12, totalWords: 3000, moodTrend: [], topTags: [] });
    }
    if (p === '/prompts/today') return json(route, { prompt: null });
    if (p === '/resurface') {
      return json(route, {
        items: [
          { kind: 'on_this_day', reason: 'One year ago today', entry: summary(10, 'Lake walk before work', '2025-10-18') },
          { kind: 'echo', reason: 'A day that stayed with you', entry: summary(11, 'Hard conversation with Dad', '2025-06-02') },
          { kind: 'unfinished', reason: 'You mentioned booking the train', entry: summary(12, 'Plans for Porto', '2026-03-09') },
          { kind: 'echo', reason: 'Another echo', entry: summary(13, 'Fourth card should not show', '2025-01-02') },
        ],
      });
    }
    if (p === '/companion') {
      return json(route, {
        companion: { stage: 3, xp: 120, nextStageAt: 200, mood: 'content', lastWroteAt: '2026-10-17T20:00:00.000Z' },
        milestones: [{ key: 'first-entry', title: 'First entry', description: 'You wrote.', achievedAt: '2026-09-01T10:00:00.000Z' }],
      });
    }
    if (p === '/capsules' && m === 'GET') return json(route, { items: capsules });
    if (p === '/capsules' && m === 'POST') {
      const body = req.postDataJSON() as { title: string; unlockAt: string };
      calls.createCapsule.push(body);
      const made: MockCapsule = { id: uuid(50 + capsules.length), title: body.title, body: null, unlockAt: body.unlockAt, status: 'sealed', openedAt: null, createdAt: new Date().toISOString() };
      capsules.push(made);
      return json(route, made);
    }
    const open = /^\/capsules\/([^/]+)\/open$/.exec(p);
    if (open && m === 'POST') {
      const c = capsules.find((x) => x.id === open[1])!;
      Object.assign(c, { body: READY_BODY, status: 'opened', openedAt: new Date().toISOString() });
      return json(route, c);
    }
    const del = /^\/capsules\/([^/]+)$/.exec(p);
    if (del && m === 'DELETE') {
      capsules.splice(capsules.findIndex((x) => x.id === del[1]), 1);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (p === '/rituals/weekly' && m === 'POST') {
      const body = req.postDataJSON() as { intention?: { title: string } };
      calls.ritual.push(body);
      const now = new Date().toISOString();
      return json(route, {
        entry: { ...summary(90, 'Weekly review', TODAY), body: 'Highs', attachments: [], createdAt: now, updatedAt: now },
        intention: body.intention
          ? { id: uuid(91), title: body.intention.title, kind: 'goal', cadence: 'weekly', status: 'active', source: 'user', memoryId: null, checkins: [], createdAt: now, updatedAt: now }
          : null,
      });
    }
    return json(route, { error: 'unmocked ' + p, code: 'not_found' }, 404);
  });
  return calls;
}

/** Moves `new Date()` to the test day but keeps time (and animation frames) running, unlike clock.setFixedTime. */
async function shiftClock(page: Page, at = SUNDAY) {
  await page.addInitScript((target) => {
    const Real = Date;
    const offset = target - Real.now();
    class Shifted extends Real {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(Real.now() + offset);
        else super(...(args as [number]));
      }
      static override now() {
        return Real.now() + offset;
      }
    }
    window.Date = Shifted as unknown as DateConstructor;
  }, Date.parse(at));
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.use({ timezoneId: 'Europe/London' });

for (const world of ['lamplight', 'jelly', 'chrome'] as const) {
  test.describe(`time and memory in ${world}`, () => {
    test.beforeEach(async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await shiftClock(page);
      void context;
    });

    test('Today shows Remember when, the companion slot and the Sunday card', async ({ page, context }) => {
      await setup(page, context, world);
      await page.goto('/app/today');
      const strip = page.getByTestId('remember-when');
      await expect(strip.getByRole('link')).toHaveCount(3);
      await expect(strip).toContainText('One year ago today');
      await expect(strip).toContainText('You mentioned booking the train');
      await expect(strip).not.toContainText('Fourth card');
      await expect(page.getByTestId('weekly-review-card')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Write to future you' })).toHaveAttribute('href', /capsules\?new=1/);
      await expect(page.getByTestId('today-companion')).toHaveAttribute('data-state', 'idle');
      await strip.getByRole('link').first().click();
      await expect(page).toHaveURL(/\/app\/entries\//);
    });

    test('Today has no serious accessibility violations', async ({ page, context }) => {
      await setup(page, context, world);
      await page.goto('/app/today');
      await expect(page.getByTestId('remember-when')).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });

    test('capsules: sealed rows hide the letter, validation, sealing, opening', async ({ page, context }) => {
      const calls = await setup(page, context, world);
      await page.goto('/app/journal/capsules');
      const sealed = page.getByRole('listitem').filter({ hasText: 'For the day I move' });
      await expect(sealed).toContainText('Opens');
      await expect(sealed.getByRole('button', { name: /Open/ })).toHaveCount(0);
      expect(await page.content()).not.toContain(SEALED_SECRET);
      expect(await page.content()).not.toContain(READY_BODY);

      // Composer validation
      await page.getByRole('button', { name: 'Write to future you' }).first().click();
      await page.getByRole('button', { name: 'Seal letter' }).click();
      await expect(page.getByText('Give your letter a title.')).toBeVisible();
      await expect(page.getByText('Write something for future you.')).toBeVisible();
      await page.getByLabel('Title').fill('Hello, October me');
      await page.getByLabel('Your letter').fill('You were tired, but you kept going.');
      await page.getByRole('button', { name: 'Pick a date' }).click();
      await page.getByLabel('Opening day').fill('2026-10-19');
      await page.getByRole('button', { name: 'Seal letter' }).click();
      await expect(page.getByText('Pick a day at least 24 hours from now.')).toBeVisible();
      expect(await axe(page)).toEqual([]);

      await page.getByRole('button', { name: '1 year' }).click();
      await expect(page.getByTestId('capsule-when')).toContainText('2027');
      await page.getByRole('button', { name: 'Seal letter' }).click();
      const dialog = page.getByRole('dialog', { name: 'Seal this letter?' });
      await expect(dialog).toContainText('You won’t be able to read');
      await dialog.getByRole('button', { name: 'Seal it' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: 'Hello, October me' })).toContainText('Opens');
      expect(calls.createCapsule).toHaveLength(1);
      expect((calls.createCapsule[0] as { unlockAt: string }).unlockAt).toMatch(/^2027-10-18T/);

      // Opening the ready capsule
      await page.getByRole('button', { name: 'Open “Before the interview”' }).click();
      const reveal = page.getByRole('dialog');
      await expect(reveal.getByTestId('capsule-letter')).toContainText(READY_BODY);
      await expect(reveal.getByTestId('capsule-letter').locator('.prose-journal')).toBeVisible();
      await page.waitForTimeout(600); // let the dialog and letter finish fading in before measuring contrast
      expect(await axe(page)).toEqual([]);
      await reveal.getByRole('button', { name: 'Close', exact: true }).last().click();
      await expect(page.getByRole('listitem').filter({ hasText: 'Before the interview' })).toContainText('Opened');

      // Delete with confirmation
      await page.getByRole('button', { name: 'Delete “For the day I move”' }).click();
      await page.getByRole('dialog', { name: 'Delete this capsule?' }).getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: 'For the day I move' })).toHaveCount(0);
    });

    test('ritual: three skippable steps, draft survives a reload, then the entry link', async ({ page, context }) => {
      const calls = await setup(page, context, world);
      await page.goto('/app/ritual');
      await expect(page.getByRole('heading', { name: 'What went well this week?' })).toBeVisible();
      await page.getByLabel('Highs').fill('A long walk with Mia');
      await page.reload();
      await expect(page.getByLabel('Highs')).toHaveValue('A long walk with Mia');
      await page.getByRole('button', { name: 'Skip' }).click();
      await expect(page.getByRole('heading', { name: 'What was hard?' })).toBeFocused();
      await page.getByRole('button', { name: 'Skip' }).click();
      await page.getByLabel('Intention').fill('Call Gran on Sunday');
      await page.getByLabel('How often? (optional)').selectOption('weekly');
      expect(await axe(page)).toEqual([]);
      await page.getByRole('button', { name: 'Save my week' }).click();
      await expect(page.getByRole('heading', { name: 'Your week is saved' })).toBeVisible();
      await expect(page.getByText('Call Gran on Sunday')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Read your entry' })).toHaveAttribute('href', /\/app\/entries\//);
      expect(calls.ritual).toHaveLength(1);
      // Done this week: Today no longer nudges.
      await page.goto('/app/today');
      await expect(page.getByTestId('weekly-review-card')).toHaveCount(0);
    });
  });
}

test('the opening ceremony plays with motion, then shows the letter', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await shiftClock(page);
  await setup(page, context, 'jelly');
  await page.goto('/app/journal/capsules');
  await page.getByRole('button', { name: 'Open “Before the interview”' }).click();
  await expect(page.getByTestId('capsule-seal')).toBeVisible();
  await expect(page.getByTestId('capsule-letter')).toContainText(READY_BODY, { timeout: 6000 });
});

test('teen mode hides streak counts on Today', async ({ page, context }) => {
  await shiftClock(page);
  await setup(page, context, 'lamplight', { mode: 'teen' });
  await page.goto('/app/today');
  await expect(page.getByTestId('remember-when')).toBeVisible();
  await expect(page.getByText(/in a row|started a streak/)).toHaveCount(0);
});

/** Screenshots for design review: W1_SHOTS=1 npx playwright test e2e/v3-time.spec.ts -g screenshots --project=desktop */
test.describe('screenshots', () => {
  test.skip(!process.env.W1_SHOTS, 'set W1_SHOTS=1');
  for (const world of ['lamplight', 'jelly', 'chrome'] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [vp, size] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
        test(`screenshots ${world} ${scheme} ${vp}`, async ({ page, context }) => {
          test.setTimeout(90_000);
          await page.setViewportSize(size);
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await shiftClock(page);
          await setup(page, context, world);
          const out = (n: string) => `../../.tmp/screens/w1-${world}-${n}-${vp}-${scheme}.png`;
          await page.goto('/app/today');
          await expect(page.getByTestId('remember-when')).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(500);
          await page.screenshot({ path: out('today'), fullPage: true });
          await page.goto('/app/journal/capsules?new=1');
          await page.getByRole('button', { name: '1 year' }).click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: out('composer'), fullPage: true });
          await page.goto('/app/journal/capsules');
          await expect(page.getByText('For the day I move')).toBeVisible();
          await page.waitForTimeout(300);
          await page.screenshot({ path: out('capsules'), fullPage: true });
          await page.getByRole('button', { name: 'Open “Before the interview”' }).click();
          await expect(page.getByTestId('capsule-letter')).toBeVisible();
          await page.waitForTimeout(600);
          if (process.env.W1_DEBUG) console.log(await page.evaluate(() => { const d = document.querySelector('dialog[open]') as HTMLElement | null; if (!d) return 'no open dialog'; const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); return JSON.stringify({ r, op: cs.opacity, tr: cs.transform, vis: cs.visibility, disp: cs.display }); }));
          await page.screenshot({ path: out('reveal') });
          await page.goto('/app/ritual');
          await page.getByLabel('Highs').fill('A long walk with Mia and a slow Sunday morning.');
          await page.waitForTimeout(300);
          await page.screenshot({ path: out('ritual'), fullPage: true });
        });
      }
    }
  }
});
