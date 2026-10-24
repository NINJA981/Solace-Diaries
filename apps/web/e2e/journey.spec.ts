/**
 * The whole product, end to end, as one person would use it: sign up, onboard, write (with a
 * reload mid-sentence and a photo), find it again, wait for Solace to read it, ask about it,
 * look at insights, export, write offline, and finally delete the account.
 *
 * Needs the real local stack: API on :8787 (with the deterministic Gemini stand-in) and
 * Supabase on :55321, configured through apps/web/.env. One fresh user per run and project.
 *
 *   npx playwright test e2e/journey.spec.ts --project=desktop
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const SCREENS = fileURLToPath(new URL('../../../.tmp/screens/', import.meta.url));

const HARBOUR_TITLE = 'Morning at the harbour';
const HARBOUR_BODY =
  'Walked down to the harbour before work with Maya. The ferries were already crossing, gulls everywhere, and the water was flat and silver.\n\n' +
  'Maya said the early ferries are the best part of living here. I think she is right. I want to come back on Sunday.';
const MORE_TEXT = ' We counted seven ferries before the coffee went cold.';
const WORK_TITLE = 'Deadline week';
const WORK_BODY =
  'Work deadlines are piling up: the quarterly report is due Friday and the launch review moved to Thursday.\n\n' +
  'I blocked two hours each morning for the report and told the team I would skip the planning meeting.';
const OFFLINE_TEXT = ' Wrote this line on the train with no signal.';
const PASSWORD = 'harbour-ferries-2026!';

type Phase = 'normal' | 'reload' | 'offline' | 'deleted';

test.use({ timezoneId: 'Europe/London', reducedMotion: 'reduce' });

test('journey: sign up → write → find → reflect → insights → export → offline → delete', async ({ page, context, isMobile }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const project = testInfo.project.name;
  const email = `e2e-${Date.now()}-${project}@example.com`;
  mkdirSync(SCREENS, { recursive: true });

  // ── Problems collected throughout (asserted at the end) ──────────────────────────────
  let phase: Phase = 'normal';
  const problems: string[] = [];
  const tolerated: string[] = [];
  const note = (allowed: boolean, line: string) => (allowed ? tolerated : problems).push(`[${phase}] ${line}`);
  page.on('pageerror', (err) => problems.push(`[${phase}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Network-level failures are judged by the request/response handlers below; the console
    // copy of them ("Failed to load resource…") is only noise.
    note(/Failed to load resource|net::ERR_/i.test(text), `console: ${text}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? '';
    // Navigations/reloads and React Query cancellations abort in-flight requests by design.
    const aborted = /ERR_ABORTED|NS_BINDING_ABORTED/.test(failure);
    note(aborted || phase === 'offline' || phase === 'reload', `requestfailed: ${req.method()} ${req.url()} ${failure}`);
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    // After deletion the old token belongs to nobody: API 401s, GoTrue refusing the local
    // logout (403), and the failed sign-in attempt (400) are all expected.
    const after =
      phase === 'deleted' &&
      (res.status() === 401 ||
        (res.status() === 403 && url.includes('/auth/v1/logout')) ||
        (res.status() === 400 && url.includes('/auth/v1/token')));
    note(after, `http ${res.status()}: ${res.request().method()} ${url}`);
  });

  const axeCheck = async (name: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const all = results.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    if (all.length) {
      await testInfo.attach(`axe-${name}`, { body: all.join('\n'), contentType: 'text/plain' });
      console.log(`    axe ${name} (all impacts): ${all.join(' | ')}`);
    }
    const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect.soft(severe.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe on ${name}`).toEqual([]);
  };
  // test.step with a timing line per step, so a run reads as a checklist.
  const step = async (name: string, fn: () => Promise<void>) => {
    const started = Date.now();
    try {
      await test.step(name, fn);
      console.log(`  ✓ [${project}] ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.log(`  ✗ [${project}] ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      throw err;
    }
  };
  const shot = (name: string) => page.screenshot({ path: `${SCREENS}e2e-${name}-${project}.png` });

  const mainNav = () => page.getByRole('navigation', { name: 'Main' });
  const go = async (label: 'Today' | 'Journal' | 'Reflect' | 'Insights') => {
    await mainNav().getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  };
  const goSettings = async () => {
    if (isMobile) {
      await page.getByRole('button', { name: /^Account menu for/ }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
    } else {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  };

  const title = page.getByRole('textbox', { name: 'Title' });
  const body = page.getByRole('textbox', { name: 'Entry', exact: true });
  const saveStatus = page.getByRole('status').filter({ hasText: /^(Saved|Saving…|Offline\. Saved on this device|Couldn’t save.*|Two versions\. Choose one)$/ });
  const saved = () => expect(saveStatus).toHaveText('Saved', { timeout: 15_000 });

  let harbourUrl = '';

  // ── 1. Landing → sign up → onboarding → Today ────────────────────────────────────────
  await step('1. sign up and onboard', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start your journal' }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Start your journal' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // The age gate comes first (an adult answer: 1990).
    await expect(page).toHaveURL(/\/age$/);
    await page.getByLabel('Month').selectOption('6');
    await page.getByLabel('Year').selectOption('1990');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { level: 1, name: 'What should Solace call you?' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Your name' }).fill('Robin');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Pick your vibe: four live previews; Lamplight stays selected (the default world).
    await expect(page.getByRole('heading', { level: 1, name: 'How should your journal feel?' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Lamplight/ })).toBeChecked();
    await expect(page.getByRole('radio')).toHaveCount(4 + 3);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'When does your day happen?' })).toBeVisible();
    const tz = page.getByRole('combobox', { name: 'Timezone' });
    await tz.click();
    await tz.fill('London');
    await page.getByRole('option', { name: /Europe \/ London/ }).click();
    await expect(tz).toHaveValue(/Europe \/ London/);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'How should Solace talk with you?' })).toBeVisible();
    await page.getByText('Curious', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /Curious/ })).toBeChecked();
    await page.getByRole('button', { name: 'Start writing' }).click();

    await expect(page).toHaveURL(/\/app\/today$/);
    await expect(page.getByRole('heading', { level: 1, name: /, Robin$/ })).toBeVisible();
  });

  // ── 2. Write, save, reload mid-typing ────────────────────────────────────────────────
  await step('2. write an entry; reload mid-typing keeps every word', async () => {
    await title.fill(HARBOUR_TITLE);
    await body.fill(HARBOUR_BODY);
    await saved();

    await body.click();
    await page.keyboard.press('ControlOrMeta+End');
    phase = 'reload';
    await page.keyboard.type(MORE_TEXT, { delay: 5 });
    await page.reload();
    await expect(title).toHaveValue(HARBOUR_TITLE, { timeout: 15_000 });
    await expect(body).toHaveValue(HARBOUR_BODY + MORE_TEXT);
    await saved();
    phase = 'normal';
    // And the server really has it: a fresh load of the entry shows the full text.
    await page.reload();
    await expect(body).toHaveValue(HARBOUR_BODY + MORE_TEXT, { timeout: 15_000 });
  });

  // ── 3. Mood + photo ──────────────────────────────────────────────────────────────────
  await step('3. set a mood and attach a photo', async () => {
    const calm = page.getByRole('button', { name: 'Calm', exact: true });
    await calm.click();
    await expect(calm).toHaveAttribute('aria-pressed', 'true');
    await saved();

    const png = testInfo.outputPath('harbour.png');
    await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: 40, g: 90, b: 140 } } })
      .png()
      .toFile(png);
    await page.locator('input[type="file"]').setInputFiles(png);
    const thumb = page.getByRole('img', { name: 'Photo attached to this entry' });
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 15_000 }).toBe(96);
    await expect(page.getByRole('region', { name: 'Photos' })).toContainText('1 of');
    await shot('today');
    await axeCheck('today');
  });

  // ── 4. Second entry ──────────────────────────────────────────────────────────────────
  await step('4. start a second entry about work', async () => {
    await page.getByRole('button', { name: 'New entry' }).click();
    await expect(title).toHaveValue('');
    await expect(body).toHaveValue('');
    await title.fill(WORK_TITLE);
    await body.fill(WORK_BODY);
    await saved();
    await expect(page.getByRole('complementary', { name: 'Recent entries' }).getByRole('link', { name: HARBOUR_TITLE })).toBeVisible({ timeout: 15_000 });
  });

  // ── 5. Journal: timeline, search, calendar ───────────────────────────────────────────
  await step('5. journal timeline, search (both modes) and calendar', async () => {
    await go('Journal');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('link', { name: HARBOUR_TITLE })).toBeVisible();
    await expect(panel.getByRole('link', { name: WORK_TITLE })).toBeVisible();
    await axeCheck('journal');

    const search = page.getByRole('searchbox', { name: 'Search your journal' });
    await search.fill('ferries');
    await page.getByRole('tab', { name: 'Exact words' }).click();
    await expect(page).toHaveURL(/mode=keyword/);
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(results.getByRole('link', { name: HARBOUR_TITLE })).toBeVisible();
    await expect(results.getByRole('link', { name: WORK_TITLE })).toHaveCount(0);
    await expect(results.getByRole('status')).toHaveText('1 entry found');
    await expect(results.locator('mark').first()).toHaveText(/ferries/i);
    await shot('journal-search');

    await page.getByRole('tab', { name: 'By meaning' }).click();
    await expect(page).not.toHaveURL(/mode=keyword/);
    await expect(results.getByRole('status')).toHaveText(/\d+ (entry|entries) found/, { timeout: 15_000 });
    await expect(results.getByRole('article').first()).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByRole('tab', { name: 'Calendar' }).click();
    const todayCell = page.getByRole('grid', { name: /^Entries in / }).locator('button[aria-current="date"]');
    await expect(todayCell).toHaveAccessibleName(/: 2 entries/);
    await todayCell.click();
    await expect(page.getByRole('region', { name: /^Entries on / }).getByRole('link', { name: HARBOUR_TITLE })).toBeVisible();
    await shot('journal-calendar');
    await page.getByRole('tab', { name: 'Timeline' }).click();
  });

  // ── 6. Enrichment ────────────────────────────────────────────────────────────────────
  await step('6. Solace reads the entry (enrichment)', async () => {
    await page.getByRole('tabpanel').getByRole('link', { name: HARBOUR_TITLE }).click();
    await expect(page).toHaveURL(/\/app\/entries\/[0-9a-f-]{36}$/);
    harbourUrl = page.url();
    await expect(title).toHaveValue(HARBOUR_TITLE);
    // The entry page polls while enrichment is pending (debounced ~20s after the last edit).
    const solaceNote = page.getByRole('complementary', { name: 'Solace’s note' });
    await expect(solaceNote).toBeVisible({ timeout: 90_000 });
    await expect(solaceNote).not.toBeEmpty();
    // The user's mood stays the user's.
    await expect(page.getByRole('button', { name: 'Calm', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  // ── 7. Reflect ───────────────────────────────────────────────────────────────────────
  await step('7. reflect: streamed answer with a citation that opens the entry', async () => {
    await go('Reflect');
    const ask = page.getByRole('textbox', { name: 'Ask about your journal' });
    await ask.fill('When did I go to the harbour?');
    const streamed = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/threads\/[^/]+\/messages$/.test(r.url()));
    await ask.press('Enter');
    expect((await streamed).headers()['content-type']).toContain('text/event-stream');
    await expect(page).toHaveURL(/\/app\/reflect\/[0-9a-f-]{36}$/);
    // Streaming: the composer offers Stop. Finished and stored: Regenerate appears under the answer.
    await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: 'Stop answer' })).toHaveCount(0);
    const sources = page.getByRole('region', { name: 'From your journal' }).last();
    await expect(sources.getByRole('link').first()).toBeVisible();
    const cite = sources.getByRole('link', { name: new RegExp(HARBOUR_TITLE) });
    await expect(cite).toBeVisible();
    await shot('reflect');
    await axeCheck('reflect');
    await cite.click();
    await expect(page).toHaveURL(harbourUrl);
    await expect(title).toHaveValue(HARBOUR_TITLE);
  });

  // ── 8. Insights ──────────────────────────────────────────────────────────────────────
  await step('8. insights: heatmap, 1-day streak, memories', async () => {
    await go('Insights');
    await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('grid', { name: /^Days you wrote/ })).toBeVisible();
    const streak = page.locator('dl > div').filter({ has: page.getByRole('term').filter({ hasText: /^Day streak$/ }) });
    await expect(streak.getByRole('definition')).toHaveText('1');
    const entries = page.locator('dl > div').filter({ has: page.getByRole('term').filter({ hasText: /^Entries$/ }) });
    await expect(entries.getByRole('definition')).toHaveText('2');
    const memories = page.getByRole('region', { name: 'What Solace remembers' });
    await expect(memories).toBeVisible();
    await expect(memories.getByRole('tab', { name: 'Active' })).toBeVisible();
    // With the stand-in, memories may be few or none; either the list or the empty state renders.
    await expect(memories.getByText(/Nothing remembered yet|memor(y|ies)$/).first()).toBeVisible({ timeout: 15_000 });
    await shot('insights');
    await axeCheck('insights');
  });

  // ── 9. Export ────────────────────────────────────────────────────────────────────────
  await step('9. settings: export Markdown and JSON', async () => {
    await goSettings();
    await axeCheck('settings');

    const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export as Markdown' }).click()]);
    expect(md.suggestedFilename()).toMatch(/\.md$/);
    const mdText = readFileSync((await md.path())!, 'utf8');
    expect(mdText).toContain(HARBOUR_TITLE);
    expect(mdText).toContain(WORK_TITLE);

    const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export as JSON' }).click()]);
    expect(json.suggestedFilename()).toMatch(/\.json$/);
    const data = JSON.parse(readFileSync((await json.path())!, 'utf8')) as unknown;
    expect(JSON.stringify(data)).toContain(HARBOUR_TITLE);
  });

  // ── 10. Offline ──────────────────────────────────────────────────────────────────────
  await step('10. offline writing saves on the device, then syncs', async () => {
    await go('Today');
    await expect(title).toHaveValue(WORK_TITLE, { timeout: 15_000 });
    phase = 'offline';
    await context.setOffline(true);
    await body.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(OFFLINE_TEXT, { delay: 5 });
    await expect(saveStatus).toHaveText('Offline. Saved on this device', { timeout: 15_000 });
    await context.setOffline(false);
    await saved();
    phase = 'normal';
    await page.reload();
    await expect(body).toHaveValue(WORK_BODY + OFFLINE_TEXT, { timeout: 15_000 });
  });

  // ── 11. Delete account ───────────────────────────────────────────────────────────────
  await step('11. delete the account; the credentials stop working', async () => {
    await goSettings();
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account and journal?' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Delete everything' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: `Type ${email} to confirm` }).fill(email);
    phase = 'deleted';
    await confirm.click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'A private journal that remembers.' })).toBeVisible();

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // ── 12. Nothing unexpected went wrong along the way ──────────────────────────────────
  await step('12. no unexpected console errors or failed requests', async () => {
    await testInfo.attach('tolerated', { body: tolerated.join('\n') || '(none)', contentType: 'text/plain' });
    for (const line of tolerated) console.log(`    tolerated ${line}`);
    expect(problems).toEqual([]);
  });
});
