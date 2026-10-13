import { encodeSse, type ChatStreamEvent } from '@solace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase-lazy', () => ({
  getSupabase: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));

const { api, ApiRequestError, readEventStream, setUnauthorizedHandler, toApiError, WAKING_UP_MESSAGE, OFFLINE_MESSAGE } =
  await import('./api');

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const UUID = '7a0d2c4e-1111-4c4c-8888-123456789abc';
const profile = {
  id: UUID,
  email: 'maya@example.com',
  displayName: 'Maya',
  timezone: 'Europe/London',
  onboardingDone: true,
  aiStyle: 'gentle',
  reminderHour: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('toApiError', () => {
  it('uses the contract error body when present', async () => {
    const err = await toApiError(
      json({ error: 'Title is too long.', code: 'validation_failed', fields: { title: 'Too long' }, requestId: 'r1' }, 400),
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, message: 'Title is too long.', code: 'validation_failed', fields: { title: 'Too long' }, requestId: 'r1' });
  });

  it('survives non-JSON bodies with a friendly sentence', async () => {
    const err = await toApiError(new Response('<html>oops</html>', { status: 500 }));
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/something went wrong/i);
  });

  it('explains cold starts for gateway errors, even when the proxy sends JSON', async () => {
    for (const status of [502, 503, 504]) {
      const err = await toApiError(json({ error: 'Bad gateway' }, status));
      expect(err.message).toBe(WAKING_UP_MESSAGE);
      expect(err.code).toBe('unavailable');
    }
  });

  it('falls back to the x-request-id header', async () => {
    const err = await toApiError(new Response('nope', { status: 404, headers: { 'x-request-id': 'abc' } }));
    expect(err.requestId).toBe('abc');
    expect(err.message).toMatch(/couldn’t find/);
  });
});

describe('typed route calls', () => {
  it('fills path params, encodes the query, attaches auth and the BYOK header', async () => {
    localStorage.setItem('solace.geminiKey', 'AIzaSyD-test-key-1234567890abcdefghijk');
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    await api.listEntries({ query: { limit: 5, mood: 'calm', tag: undefined } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/api/entries?limit=5&mood=calm');
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-token');
    expect(headers['x-gemini-key']).toBe('AIzaSyD-test-key-1234567890abcdefghijk');
    expect(init!.credentials).toBe('omit');
  });

  it('sends JSON bodies and custom headers', async () => {
    fetchMock.mockResolvedValueOnce(json(profile));
    const result = await api.updateMe({ body: { displayName: 'Maya' }, headers: { 'If-Match': '3' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/api/me');
    expect(init!.method).toBe('PATCH');
    expect(init!.body).toBe('{"displayName":"Maya"}');
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init!.headers as Record<string, string>)['If-Match']).toBe('3');
    expect(result.displayName).toBe('Maya');
  });

  it('encodes path params and resolves 204 as undefined', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteEntry({ params: { id: 'a/b' } })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8787/api/entries/a%2Fb');
  });

  it('maps network failures to a friendly ApiRequestError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.getMe()).rejects.toMatchObject({ status: 0, code: 'network_error', message: OFFLINE_MESSAGE });
  });

  it('rethrows aborts untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(api.getMe({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs the global sign-out flow once for a burst of 401s', async () => {
    let release!: () => void;
    const handler = vi.fn(() => new Promise<void>((r) => (release = r)));
    setUnauthorizedHandler(handler);
    fetchMock.mockImplementation(async () => json({ error: 'Unauthorized', code: 'unauthorized' }, 401));
    const results = await Promise.allSettled([api.getMe(), api.listThreads(), api.graph()]);
    expect(results.every((r) => r.status === 'rejected' && (r.reason as { status: number }).status === 401)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    release();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uploads attachments as multipart with a `file` field', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: UUID, entryId: UUID, mime: 'image/webp', width: 10, height: 10, description: null, url: 'https://x.supabase.co/a', createdAt: profile.createdAt }),
    );
    const file = new Blob(['x'], { type: 'image/png' });
    await api.addAttachment({ params: { id: UUID }, file });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://localhost:8787/api/entries/${UUID}/attachments`);
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect((init!.headers as Record<string, string>)['content-type']).toBeUndefined();
  });
});

// ───────────────────────── SSE ─────────────────────────

function streamOf(chunks: string[], { error }: { error?: boolean } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (error) controller.error(new TypeError('network'));
      else controller.close();
    },
  });
}

const message = { id: UUID, role: 'assistant', content: 'Hi', citations: [], createdAt: profile.createdAt };

describe('readEventStream', () => {
  it('parses events split across arbitrary chunk boundaries and validates them', async () => {
    const full =
      encodeSse('sources', { citations: [] }) +
      encodeSse('token', { text: 'Hel' }) +
      ': keep-alive comment\n\n' +
      encodeSse('token', { text: 'lo' }) +
      encodeSse('token', { nope: true }) + // malformed: ignored
      'event: token\ndata: {not json\n\n' + // unparsable: ignored
      encodeSse('done', { message, userMessage: null });
    const chunks = full.match(/[\s\S]{1,7}/g)!;
    const events: ChatStreamEvent[] = [];
    await readEventStream(streamOf(chunks), (e) => events.push(e));
    expect(events.map((e) => e.event)).toEqual(['sources', 'token', 'token', 'done']);
    expect(events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text).join('')).toBe('Hello');
  });

  it('handles CRLF framing and a final event without a trailing blank line', async () => {
    const events: ChatStreamEvent[] = [];
    const body = `event: token\r\ndata: {"text":"a"}\r\n\r\nevent: done\r\ndata: ${JSON.stringify({ message, userMessage: null })}`;
    await readEventStream(streamOf([body]), (e) => events.push(e));
    expect(events.map((e) => e.event)).toEqual(['token', 'done']);
  });

  it('delivers server error events and resolves', async () => {
    const events: ChatStreamEvent[] = [];
    await readEventStream(streamOf([encodeSse('error', { error: 'Daily AI limit reached.', code: 'ai_quota_exceeded' })]), (e) => events.push(e));
    expect(events).toEqual([{ event: 'error', data: { error: 'Daily AI limit reached.', code: 'ai_quota_exceeded' } }]);
  });

  it('rejects with stream_interrupted when the stream ends early', async () => {
    await expect(readEventStream(streamOf([encodeSse('token', { text: 'a' })]), () => {})).rejects.toMatchObject({ code: 'stream_interrupted' });
    await expect(readEventStream(streamOf([encodeSse('token', { text: 'a' })], { error: true }), () => {})).rejects.toMatchObject({
      code: 'stream_interrupted',
    });
  });

  it('rejects with AbortError when aborted mid-stream', async () => {
    const controller = new AbortController();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(encodeSse('token', { text: 'a' })));
      },
    });
    const done = readEventStream(body, () => controller.abort(), controller.signal);
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });
});
