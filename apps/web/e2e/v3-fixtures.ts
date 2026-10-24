/**
 * Mocked API for the v3 Insights/Reflect specs. These are test fixtures for a fake user; they are
 * never shown as real data anywhere in the app. Every response validates against the shared schemas.
 */
import type { BrowserContext, Page, Route } from '@playwright/test';

const API = 'http://127.0.0.1:8787/api';
const USER = '7a0c6a52-6a2e-4b65-9a7a-0d6c1f6b2d11';
export const TODAY = '2026-10-14';
export const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export const profile = {
  id: USER,
  email: 'sam@example.com',
  displayName: 'Sam Rivera',
  timezone: 'Europe/London',
  onboardingDone: true,
  aiStyle: 'gentle',
  reminderHour: null,
  world: 'lamplight',
  soundEnabled: false,
  hapticsEnabled: false,
  companionName: '',
  mode: 'adult',
  ageConfirmed: true,
  consentStatus: 'not_required',
  createdAt: '2025-09-01T10:00:00.000Z',
};

const summary = (i: number, title: string, date: string) => ({
  id: uuid(1000 + i),
  title,
  entryDate: date,
  mood: 'calm',
  moodSource: 'user',
  tags: ['nature'],
  summary: null,
  wordCount: 80,
  version: 1,
  enrichmentStatus: 'ready',
  createdAt: `${date}T08:00:00.000Z`,
  updatedAt: `${date}T08:00:00.000Z`,
  excerpt: 'The water was flat as glass and I let my shoulders drop.',
  attachmentCount: 0,
});

const cites = [
  { n: 1, entryId: uuid(1000), title: 'Lake walk before work', entryDate: '2026-09-20', snippet: 'The water was flat as glass.' },
  { n: 2, entryId: uuid(1001), title: 'Sunday reset', entryDate: '2026-08-02', snippet: 'Cleaned the desk, planned the week.' },
];

function stats() {
  const days = [];
  for (let i = 120; i >= 0; i -= 3) days.push({ date: addDays(TODAY, -i), count: 1, words: 120, moodScore: ((i % 5) - 2) * 0.6, mood: 'calm' });
  const monday = addDays(TODAY, -((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7));
  return {
    today: TODAY,
    days,
    currentStreak: 4,
    longestStreak: 17,
    totalEntries: 186,
    totalWords: 48210,
    moodTrend: Array.from({ length: 12 }, (_, w) => ({ weekStart: addDays(monday, -7 * (11 - w)), avgScore: Math.sin(w / 2) * 0.8, counts: { calm: 3, tired: 1 } })),
    topTags: [{ tag: 'family', count: 21 }],
  };
}

const unwrappedFull = {
  period: 'month',
  label: 'September 2026',
  from: '2026-09-01',
  to: '2026-09-30',
  minEntries: 5,
  persona: { key: 'night-owl', name: 'Night-owl processor', description: 'You do your thinking late, and you write most when the day has quietened.', traits: ['Reflective', 'Steady', 'Evening writer'] },
  slides: [
    { kind: 'totals', entries: 24, words: 5120, days: 18 },
    { kind: 'moods', counts: { calm: 8, hopeful: 6, tired: 5, reflective: 3, anxious: 2 }, top: 'calm' },
    { kind: 'tags', top: [{ tag: 'family', count: 9 }, { tag: 'work', count: 7 }, { tag: 'nature', count: 5 }] },
    { kind: 'streak', longest: 9, current: 4 },
    { kind: 'rhythm', byHour: [0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 2, 3, 5, 6, 4, 1], byWeekday: [3, 4, 2, 3, 4, 5, 3], peakHour: 21 },
    { kind: 'bookends', first: summary(1, 'A slow start', '2026-09-01'), last: summary(2, 'Last light', '2026-09-30') },
    { kind: 'people', top: [{ name: 'Mia', count: 7 }, { name: 'Dad', count: 4 }] },
    { kind: 'highlight', entry: summary(0, 'Lake walk before work', '2026-09-20'), reason: 'The calmest entry of the month.' },
  ],
};

export type Scenario = {
  world?: string;
  mode?: 'adult' | 'teen';
  unwrappedThin?: boolean;
  canWrite?: boolean;
  letterError?: 'ai_quota_exceeded' | 'rate_limited' | 'ai_unavailable';
};

export type Calls = { method: string; path: string; body: unknown }[];

export async function mockV3(page: Page, context: BrowserContext, sc: Scenario = {}) {
  const calls: Calls = [];
  const now = '2026-10-14T10:00:00.000Z';
  let checkins = [{ date: addDays(TODAY, -2), note: null }];
  const mkIntention = () => ({
    id: uuid(300),
    title: 'Walk after lunch',
    kind: 'habit',
    cadence: 'daily',
    status: 'active',
    source: 'user',
    memoryId: null,
    checkins,
    createdAt: now,
    updatedAt: now,
  });
  let chapterStamp = '2026-09-01T10:00:00.000Z';
  let wrote = false;
  let letters: unknown[] = [
    { id: uuid(400), month: '2026-09', content: 'Dear me,\n\nA year ago you wrote that the **lake** was where you went to think [1]. I hope you still do.\n\nBe kind to the tired version of yourself [2].', citations: cites, replyEntryId: null, createdAt: '2026-09-02T10:00:00.000Z' },
  ];
  const chapters = [
    { id: uuid(500), title: 'Settling in', summary: 'A quiet run of weeks learning a new rhythm.', from: '2025-11-01', to: '2026-03-31', color: 'mood-3', cast: ['Mia'], keyEntryIds: [uuid(1000)] },
    { id: uuid(501), title: 'The long climb', summary: 'Work pressure, then relief, then climbing on Thursdays.', from: '2026-04-01', to: '2026-08-31', color: 'mood-4', cast: ['Mia', 'Theo'], keyEntryIds: [uuid(1001)] },
    { id: uuid(502), title: 'Lake season', summary: 'Mornings by the water and slower weekends.', from: '2026-09-01', to: null, color: 'ai', cast: ['Dad'], keyEntryIds: [] },
  ];

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });

  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return json(route, {});
    const url = new URL(req.url());
    const p = url.pathname.replace('/api', '');
    const m = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* no body */
    }
    if (m !== 'GET') calls.push({ method: m, path: p, body });
    const prof = { ...profile, world: sc.world ?? 'lamplight', mode: sc.mode ?? 'adult' };

    if (p === '/me') return json(route, prof);
    if (p === '/entries') return json(route, { items: [], nextCursor: null });
    if (p === '/insights/stats') return json(route, stats());
    if (p === '/insights/weekly') return json(route, { letter: null, minEntries: 3 });
    if (p === '/memories') return json(route, { items: [] });
    if (p === '/memories/graph') return json(route, { nodes: [], edges: [] });
    if (p === '/prompts/today') return json(route, { prompt: null });
    if (p === '/insights/correlations')
      return json(route, {
        minEntries: 10,
        items: [
          { tag: 'walks', entries: 9, avgMood: 1.4, baseline: 0.5, delta: 0.9 },
          { tag: 'deadlines', entries: 6, avgMood: -0.4, baseline: 0.5, delta: -0.9 },
          { tag: 'family', entries: 12, avgMood: 0.9, baseline: 0.5, delta: 0.4 },
          { tag: 'misc', entries: 2, avgMood: 2, baseline: 0.5, delta: 1.5 },
        ],
      });
    if (p === '/growth')
      return json(route, { items: [{ id: uuid(200), text: 'In March you wrote that mornings felt heavy [1]. Lately you describe them as the quiet part of your day [2].', citations: cites, weekStart: '2026-10-12', createdAt: now }] });
    if (p === '/intentions/suggestions') return json(route, { items: [{ memoryId: uuid(700), title: 'run a half marathon', kind: 'goal' }] });
    if (p === '/intentions' && m === 'GET') return json(route, { items: [mkIntention()] });
    if (p === '/intentions' && m === 'POST') return json(route, { ...mkIntention(), id: uuid(301), title: (body as { title: string }).title, kind: (body as { kind: string }).kind, checkins: [] });
    if (/^\/intentions\/[^/]+\/checkins$/.test(p) && m === 'POST') {
      checkins = [{ date: (body as { date: string }).date, note: null }, ...checkins];
      return json(route, mkIntention());
    }
    if (/^\/intentions\/[^/]+\/checkins\/[^/]+$/.test(p) && m === 'DELETE') {
      const d = p.split('/').pop();
      checkins = checkins.filter((c) => c.date !== d);
      return json(route, mkIntention());
    }
    if (p === '/unwrapped')
      return json(route, sc.unwrappedThin ? { ...unwrappedFull, persona: null, slides: [] } : unwrappedFull);
    if (p === '/chapters' && m === 'GET') return json(route, { items: chapters, generatedAt: chapterStamp, stale: true, minEntries: 20 });
    if (p === '/chapters/refresh') {
      chapterStamp = '2026-10-14T10:05:00.000Z';
      return json(route, { items: chapters, generatedAt: '2026-09-01T10:00:00.000Z', stale: true, minEntries: 20 });
    }
    if (p === '/letters' && m === 'GET') return json(route, { items: letters, canWrite: (sc.canWrite ?? true) && !wrote, minEntries: 8 });
    if (p === '/letters' && m === 'POST') {
      if (sc.letterError === 'ai_unavailable') return json(route, { error: 'x', code: 'ai_unavailable' }, 503);
      if (sc.letterError) return json(route, { error: 'x', code: sc.letterError }, 429);
      const l = { id: uuid(401), month: '2026-10', content: 'Dear me,\n\nYou were worried about October [1]. It went fine.', citations: cites.slice(0, 1), replyEntryId: null, createdAt: now };
      letters = [l, ...letters];
      wrote = true;
      return json(route, l);
    }
    if (/^\/letters\/[^/]+\/reply$/.test(p)) {
      const e = { ...summary(9, 'Reply to past me', TODAY), body: (body as { body: string }).body, attachments: [] };
      return json(route, e);
    }
    if (p === '/threads' && m === 'GET') return json(route, { items: [] });
    if (p === '/threads' && m === 'POST') {
      const b = body as { title?: string; mode?: string };
      return json(route, { id: uuid(900), mode: b.mode, title: b.title ?? '', createdAt: now, updatedAt: now });
    }
    if (p === `/threads/${uuid(900)}`) {
      const created = calls.filter((c) => c.method === 'POST' && c.path === '/threads').at(-1)?.body as { title?: string; mode?: string } | undefined;
      return json(route, { id: uuid(900), mode: created?.mode, title: created?.title ?? '', createdAt: now, updatedAt: now, messages: [] });
    }
    return json(route, { error: `unmocked ${m} ${p}`, code: 'not_found' }, 404);
  });

  // A signed-in session with a fake token, and a stand-in for the auth host.
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
  await context.addInitScript(
    ([world, value]) => {
      try {
        localStorage.setItem('sb-127-auth-token', value!);
        localStorage.setItem('solace.world', world!);
      } catch {
        /* storage unavailable */
      }
    },
    [sc.world ?? 'lamplight', JSON.stringify(session)],
  );
  await context.route('http://127.0.0.1:55321/**', (route) => json(route, {}));
  return calls;
}
