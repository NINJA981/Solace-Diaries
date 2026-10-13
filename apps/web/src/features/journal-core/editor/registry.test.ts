import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@solace/shared';

const server = new Map<string, Entry>();
const calls: string[] = [];

vi.mock('@/lib/api', () => {
  class ApiRequestError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  }
  const api = {
    createEntry: async ({ body }: { body: { id: string; title: string; body: string; entryDate: string } }) => {
      calls.push(`create:${body.id}`);
      const e = {
        id: body.id,
        title: body.title,
        body: body.body,
        entryDate: body.entryDate,
        mood: null,
        moodSource: null,
        tags: [],
        summary: null,
        wordCount: 0,
        version: 1,
        enrichmentStatus: 'pending',
        attachments: [],
        createdAt: '',
        updatedAt: '',
      } as Entry;
      server.set(e.id, e);
      return e;
    },
    updateEntry: async () => {
      throw new Error('unexpected');
    },
    getEntry: async ({ params }: { params: { id: string } }) => {
      const e = server.get(params.id);
      if (!e) throw new ApiRequestError(404, 'nf');
      return e;
    },
  };
  return { api, ApiRequestError };
});

const { draftStoreFor, flushPendingDrafts, acquireEngine, releaseEngine } = await import('./registry');
const { emptyFields } = await import('./syncEngine');

describe('offline queue flush', () => {
  beforeEach(() => {
    server.clear();
    calls.length = 0;
  });

  it('flushes drafts left on the device (scoped to the user) and clears them', async () => {
    const store = draftStoreFor('user-a');
    const other = draftStoreFor('user-b');
    const mk = (id: string, body: string) => ({
      id,
      fields: { ...emptyFields('2026-10-12'), body },
      synced: null,
      version: null,
      updatedAt: 1,
    });
    await store.save(mk('aaaaaaaa-0000-4000-8000-000000000001', 'left offline'));
    await other.save(mk('bbbbbbbb-0000-4000-8000-000000000002', 'someone else'));

    const remaining = await flushPendingDrafts('user-a');
    expect(remaining).toEqual([]);
    expect(calls).toEqual(['create:aaaaaaaa-0000-4000-8000-000000000001']);
    expect(server.get('aaaaaaaa-0000-4000-8000-000000000001')?.body).toBe('left offline');
    // Another user's draft is never touched.
    expect(await other.list()).toHaveLength(1);
  });

  it('shares one engine per entry so an open editor and the flusher never double-write', async () => {
    const id = 'cccccccc-0000-4000-8000-000000000003';
    const draft = { id, fields: { ...emptyFields('2026-10-13'), body: 'open' }, synced: null, version: null, updatedAt: 1 };
    await draftStoreFor('user-a').save(draft);
    const a = acquireEngine('user-a', draft);
    await flushPendingDrafts('user-a');
    const b = acquireEngine('user-a', draft);
    expect(a).toBe(b);
    await a.flush();
    expect(calls.filter((c) => c === `create:${id}`)).toHaveLength(1);
    releaseEngine(id);
    releaseEngine(id);
  });
});
