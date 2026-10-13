import { randomUUID } from 'node:crypto';
import express from 'express';
import supertest from 'supertest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { profiles } from '../src/db/schema';
import { configureJwks, ISSUER } from '../src/auth/verify-token';
import { errorHandler } from '../src/middleware/errors';
import { createTestUser, resetDb, testApi, tokenFor } from './helpers';

beforeEach(resetDb);

/** `alg: none` token with an otherwise valid payload. */
function unsignedToken(sub: string): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub, aud: 'authenticated', role: 'authenticated', exp })}.`;
}

describe('auth', () => {
  const api = testApi();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects a missing or malformed Authorization header', async () => {
    const res = await api.get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'unauthorized', requestId: expect.any(String) });
    expect((await api.get('/api/me').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await api.get('/api/me').set(bearer('not-a-jwt'))).status).toBe(401);
  });

  it('rejects forged, expired, wrong-audience and non-user tokens', async () => {
    const id = randomUUID();
    const cases = [
      await tokenFor(id, 'a@example.test', { secret: 'some-other-secret-some-other-secret' }),
      await tokenFor(id, 'a@example.test', { expiresInSec: -60 }),
      await tokenFor(id, 'a@example.test', { audience: 'anon' }),
      await tokenFor(id, 'a@example.test', { role: 'anon' }),
      await tokenFor('not-a-uuid', 'a@example.test'),
      unsignedToken(id),
    ];
    for (const token of cases) {
      const res = await api.get('/api/me').set(bearer(token));
      expect(res.status).toBe(401);
    }
    const [row] = await db.select().from(profiles).where(eq(profiles.id, id));
    expect(row).toBeUndefined();
  });

  it('accepts a valid token and creates the profile on first use', async () => {
    const user = await createTestUser('Mixed.Case@Example.test');
    const res = await api.get('/api/me').set(user.headers);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      timezone: 'UTC',
      onboardingDone: false,
    });
    const again = await api.get('/api/me').set(user.headers);
    expect(again.body.createdAt).toBe(res.body.createdAt);
  });

  it('follows an email change on the auth user', async () => {
    const user = await createTestUser();
    await api.get('/api/me').set(user.headers);
    const changed = await tokenFor(user.id, 'new-address@example.test');
    const res = await api.get('/api/me').set(bearer(changed));
    expect(res.body.email).toBe('new-address@example.test');
  });

  it('rejects a malformed x-gemini-key header', async () => {
    const user = await createTestUser();
    const res = await api.get('/api/me').set(user.headers).set('x-gemini-key', 'x'.repeat(201));
    expect(res.status).toBe(400);
    expect(
      (await api.get('/api/me').set(user.headers).set('x-gemini-key', '  key-123  ')).status,
    ).toBe(200);
  });
});

describe('health', () => {
  it('reports db status without auth', async () => {
    const res = await testApi().get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true, version: expect.any(String) });
  });
});

describe('http hardening', () => {
  const api = testApi();

  it('allows the configured origin and nothing else', async () => {
    const ok = await api
      .options('/api/entries')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,if-match,content-type');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-headers']).toMatch(/if-match/i);

    // The web app reads these from cross-origin responses (export filename, create retries).
    const user = await createTestUser();
    const exposed = await api
      .get('/api/me')
      .set(user.headers)
      .set('Origin', 'http://localhost:5173');
    const list = exposed.headers['access-control-expose-headers']!.toLowerCase().split(/,\s*/);
    expect(list).toEqual(
      expect.arrayContaining(['content-disposition', 'x-entry-created', 'etag', 'x-request-id']),
    );

    const evil = await api
      .options('/api/entries')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const evilGet = await api.get('/api/healthz').set('Origin', 'https://evil.example');
    expect(evilGet.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers, request ids and no x-powered-by', async () => {
    const res = await api.get('/api/healthz').set('X-Request-Id', 'client-trace-12345');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBe('client-trace-12345');

    const weird = await api.get('/api/healthz').set('X-Request-Id', 'bad id\twith<chars>');
    expect(weird.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns ApiError bodies for unknown routes and bad JSON', async () => {
    const user = await createTestUser();
    const missing = await api.get('/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not_found');

    const badJson = await api
      .post('/api/entries')
      .set(user.headers)
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toBe('Request body is not valid JSON.');

    const tooBig = await api
      .post('/api/entries')
      .set(user.headers)
      .send({ body: 'x'.repeat(300_000) });
    expect(tooBig.status).toBe(413);
  });

  it('reports validation failures per field', async () => {
    const user = await createTestUser();
    const res = await api
      .post('/api/entries')
      .set(user.headers)
      .send({ title: 7, mood: 'ecstatic' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(['title', 'mood']));
  });

  it('never leaks internal error messages', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.id = 'req-1';
      next();
    });
    app.get('/boom', () => {
      throw new Error('password authentication failed for user "solace" at 10.0.0.5');
    });
    app.use(errorHandler);
    const res = await supertest(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Something went wrong on our side.',
      code: 'internal_error',
      requestId: 'req-1',
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('rate limits', () => {
  it('limits writes per user with a rate_limited ApiError', async () => {
    const api = testApi({ rateLimits: { writes: 2 } });
    const user = await createTestUser();
    const other = await createTestUser();
    for (let i = 0; i < 2; i++) {
      expect((await api.post('/api/entries').set(user.headers).send({})).status).toBe(201);
    }
    const limited = await api.post('/api/entries').set(user.headers).send({});
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    // Reads and other users are unaffected.
    expect((await api.get('/api/entries').set(user.headers)).status).toBe(200);
    expect((await api.post('/api/entries').set(other.headers).send({})).status).toBe(201);
  });

  it('applies the AI limiter to hybrid search but not keyword search', async () => {
    const api = testApi({ rateLimits: { ai: 1 } });
    const user = await createTestUser();
    await api.get('/api/search?q=hi').set(user.headers);
    expect((await api.get('/api/search?q=hi').set(user.headers)).status).toBe(429);
    expect((await api.get('/api/search?q=hi&mode=keyword').set(user.headers)).status).not.toBe(429);
  });
});

describe('token issuer', () => {
  const api = testApi();

  it('accepts only tokens issued by this Supabase project', async () => {
    const id = randomUUID();
    const sign = (issuer?: string) => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ email: 'a@example.test', role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(id)
        .setAudience('authenticated')
        .setIssuedAt(now)
        .setExpirationTime(now + 600);
      if (issuer) jwt.setIssuer(issuer);
      return jwt.sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
    };
    expect(ISSUER).toBe('http://127.0.0.1:55321/auth/v1');
    for (const iss of [undefined, 'https://evil.example/auth/v1', 'http://127.0.0.1:55321']) {
      const res = await api.get('/api/me').set('Authorization', `Bearer ${await sign(iss)}`);
      expect(res.status, String(iss)).toBe(401);
    }
    const ok = await api.get('/api/me').set('Authorization', `Bearer ${await sign(ISSUER)}`);
    expect(ok.status).toBe(200);
  });
});

describe('JWKS (asymmetric keys)', () => {
  const api = testApi();
  const kid = 'key-1';
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwk: JWK;

  beforeAll(async () => {
    keys = await generateKeyPair('ES256', { extractable: true });
    jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: 'ES256', use: 'sig' };
  });
  afterEach(() => configureJwks());

  async function es256Token(opts: { kid?: string; key?: typeof keys.privateKey } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: 'k@example.test', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: opts.kid ?? kid })
      .setSubject(randomUUID())
      .setAudience('authenticated')
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(opts.key ?? keys.privateKey);
  }
  const call = async (token: string) => api.get('/api/me').set('Authorization', `Bearer ${token}`);
  const serve = (body: unknown, status = 200) =>
    configureJwks(async () => new Response(JSON.stringify(body), { status }));

  it('verifies a token against the project key set', async () => {
    serve({ keys: [jwk] });
    expect((await call(await es256Token())).status).toBe(200);
  });

  it('answers 401 for a bad signature or an unknown key id', async () => {
    serve({ keys: [jwk] });
    const other = await generateKeyPair('ES256');
    expect((await call(await es256Token({ key: other.privateKey }))).status).toBe(401);
    expect((await call(await es256Token({ kid: 'rotated-away' }))).status).toBe(401);
  });

  it('answers 503, not 401, whenever the key set cannot be fetched', async () => {
    const token = await es256Token();
    const outages: Array<[string, () => Promise<Response>]> = [
      ['HTTP 500', async () => new Response('oops', { status: 500 })],
      ['HTTP 404', async () => new Response('{}', { status: 404 })],
      ['not JSON', async () => new Response('<html>', { status: 200 })],
      ['malformed set', async () => new Response('{"keys": 5}', { status: 200 })],
      [
        'network error',
        async () => {
          throw new TypeError('fetch failed');
        },
      ],
      [
        'timeout',
        async () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      ],
    ];
    for (const [name, fetchImpl] of outages) {
      configureJwks(fetchImpl);
      const res = await call(token);
      expect(res.status, name).toBe(503);
      expect(res.body.code, name).toBe('internal_error');
    }
  });
});
