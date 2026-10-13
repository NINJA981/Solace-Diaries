import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@solace/shared';

const server = new Map<string, Entry>();
const calls: string[] = [];
let gate: Promise<void> | null = null;

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
  type CreateBody = { id: string; title: string; body: string; entryDate: string };
  const api = {
    // Idempotent like the API: an existing id answers 200 + X-Entry-Created: false with the stored row.
    createEntry: async ({ body, onResponse }: { body: CreateBody; onResponse?: (res: Response) => void }) => {
      calls.push(`create:${body.id}`);
      if (gate) await gate;
      const existing = server.get(body.id);
      if (existing) {
        onResponse?.(new Response(null, { status: 200, headers: { 'x-entry-created': 'false' } }));
        return existing;
      }
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
      onResponse?.(new Response(null, { status: 201, headers: { 'x-entry-created': 'true' } }));
      return e;
    },
    updateEntry: async ({
      params,
      body,
      headers,
    }: {
      params: { id: string };
      body: Partial<Entry>;
      headers: Record<string, string>;
    }) => {
      calls.push(`update:${params.id}`);
      const e = server.get(params.id);
      if (!e) throw new ApiRequestError(404, 'nf');
      if (String(e.version) !== headers['If-Match']) throw new ApiRequestError(409, 'stale', 'version_conflict');
      const next = { ...e, ...body, version: e.version + 1 } as Entry;
      server.set(e.id, next);
      return next;
    },
    getEntry: async ({ params }: { params: { id: string } }) => {
      const e = server.get(params.id);
      if (!e) throw new ApiRequestError(404, 'nf');
      return e;
    },
    deleteEntry: async ({ params }: { params: { id: string } }) => {
      calls.push(`delete:${params.id}`);
      server.delete(params.id);
    },
  };
  return { api, ApiRequestError };
});

const { apiTransport, deleteEntryEverywhere, draftStoreFor, flushPendingDrafts, acquireEngine, releaseEngine, forgetUserOnDevice, peekEngine, rescueAllEngines } =
  await import('./registry');
const { EntrySync, emptyFields, textHash } = await import('./syncEngine');
const { loadTodayPointer, saveTodayPointer, rescueDraft } = await import('./draftStore');
const { api } = await import('@/lib/api');

const tick = () => new Promise((r) => setTimeout(r, 0));
const mk = (id: string, body: string, extra: object = {}) => ({
  id,
  fields: { ...emptyFields('2026-10-12'), body },
  synced: null,
  version: null,
  updatedAt: 1,
  ...extra,
});
const serverDelete = (id: string) => api.deleteEntry({ params: { id } }) as Promise<void>;

beforeEach(() => {
  server.clear();
  calls.length = 0;
  gate = null;
});

describe('offline queue flush', () => {
  it('flushes drafts left on the device (scoped to the user) and clears them', async () => {
    const store = draftStoreFor('user-a');
    const other = draftStoreFor('user-b');
    await store.save(mk('aaaaaaaa-0000-4000-8000-000000000001', 'left offline'));
    await other.save(mk('bbbbbbbb-0000-4000-8000-000000000002', 'someone else'));

    const remaining = await flushPendingDrafts('user-a');
    expect(remaining).toEqual([]);
    expect(calls).toEqual(['create:aaaaaaaa-0000-4000-8000-000000000001']);
    expect(server.get('aaaaaaaa-0000-4000-8000-000000000001')?.body).toBe('left offline');
    // Another user's draft is never touched.
    expect(await other.list()).toHaveLength(1);
    await other.remove('bbbbbbbb-0000-4000-8000-000000000002');
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

  describe('a stale device snapshot flushed (by another tab) before the live tab writes', () => {
    /** The live tab: its own engine and store, as in a separate JS context. */
    function liveTab(draft: ReturnType<typeof mk>) {
      const mem = new Map<string, unknown>();
      return new EntrySync(structuredClone(draft), {
        transport: apiTransport,
        store: {
          load: async (id) => mem.get(id) as never,
          save: async (d) => void mem.set(d.id, d),
          remove: async (id) => void mem.delete(id),
          list: async () => [...mem.values()] as never,
        },
      });
    }

    it('the newer live text wins when the snapshot is one of its own earlier versions', async () => {
      const id = 'dddddddd-0000-4000-8000-000000000004';
      // The live tab saved this snapshot on the device a moment ago (with its history).
      const snapshot = mk(id, 'stale words', { history: [textHash({ title: '', body: 'stale words' })] });
      await draftStoreFor('user-a').save(snapshot);
      const live = liveTab(snapshot);
      live.edit({ body: 'stale words, now much newer' });

      await flushPendingDrafts('user-a'); // the other tab posts the stale snapshot first
      expect(server.get(id)?.body).toBe('stale words');

      await live.flush();
      expect(server.get(id)?.body).toBe('stale words, now much newer');
      expect(calls).toEqual([`create:${id}`, `create:${id}`, `update:${id}`]);
      expect(live.getSnapshot()).toMatchObject({ status: 'saved', dirty: false });
      live.dispose();
    });

    it('otherwise it is a conflict, and the live text stays on screen', async () => {
      const id = 'eeeeeeee-0000-4000-8000-000000000005';
      await draftStoreFor('user-a').save(mk(id, 'a snapshot this tab never wrote'));
      const live = liveTab(mk(id, ''));
      live.edit({ body: 'what this tab wrote' });

      await flushPendingDrafts('user-a');
      await live.flush();
      const snap = live.getSnapshot();
      expect(snap.status).toBe('conflict');
      expect(snap.fields.body).toBe('what this tab wrote');
      expect(server.get(id)?.body).toBe('a snapshot this tab never wrote');
      live.dispose();
    });
  });
});

describe('deleting an entry', () => {
  it('waits for the in-flight first POST, then always sends DELETE, and nothing re-creates it', async () => {
    const id = 'ffffffff-0000-4000-8000-000000000006';
    const engine = acquireEngine('user-a', mk(id, ''));
    engine.edit({ body: 'about to be deleted' });
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    void engine.flush();
    await tick();
    expect(calls).toEqual([`create:${id}`]);
    engine.edit({ body: 'about to be deleted, more' });

    const deleting = deleteEntryEverywhere('user-a', id, serverDelete);
    await tick();
    // The DELETE must not overtake the POST.
    expect(calls).toEqual([`create:${id}`]);
    gate = null;
    release();
    await deleting;

    expect(calls).toEqual([`create:${id}`, `delete:${id}`]);
    expect(server.has(id)).toBe(false);
    expect(peekEngine(id)).toBeUndefined();
    expect(await draftStoreFor('user-a').load(id)).toBeUndefined();

    // A later flush or a stale engine nudge can't bring it back.
    await flushPendingDrafts('user-a');
    await engine.flush();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([`create:${id}`, `delete:${id}`]);
    releaseEngine(id);
  });

  it('skips the network for an entry that was never posted', async () => {
    const id = '99999999-0000-4000-8000-000000000007';
    const engine = acquireEngine('user-a', mk(id, ''));
    engine.edit({ body: 'typed, never sent' });
    await draftStoreFor('user-a').save(engine.getDraft());
    await deleteEntryEverywhere('user-a', id, serverDelete);
    expect(calls).toEqual([]);
    expect(await draftStoreFor('user-a').load(id)).toBeUndefined();
  });

  it('sends DELETE when no editor is open (server copy only)', async () => {
    const id = '88888888-0000-4000-8000-000000000008';
    await deleteEntryEverywhere('user-a', id, serverDelete);
    expect(calls).toEqual([`delete:${id}`]);
  });

  it('lets the user retry when the DELETE fails', async () => {
    const id = '77777777-0000-4000-8000-000000000009';
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(deleteEntryEverywhere('user-a', id, failing)).rejects.toThrow('offline');
    await expect(deleteEntryEverywhere('user-a', id, serverDelete)).resolves.toBeUndefined();
    expect(calls).toEqual([`delete:${id}`]);
  });
});

describe('forgetting a user on this device (sign-out, account deletion)', () => {
  it('stops their engines and clears their drafts and Today pointer, leaving other users alone', async () => {
    const id = '66666666-0000-4000-8000-00000000000a';
    const engine = acquireEngine('user-c', mk(id, ''));
    engine.edit({ body: 'private words' });
    await draftStoreFor('user-c').save(engine.getDraft());
    await draftStoreFor('user-c').save(mk('66666666-0000-4000-8000-00000000000b', 'offline queue item'));
    await saveTodayPointer('user-c', { date: '2026-10-13', id });
    await draftStoreFor('user-d').save(mk('55555555-0000-4000-8000-00000000000c', 'other person'));
    await saveTodayPointer('user-d', { date: '2026-10-13', id: '55555555-0000-4000-8000-00000000000c' });

    await forgetUserOnDevice('user-c');
    releaseEngine(id); // the editor unmounting afterwards must not write the draft back
    await new Promise((r) => setTimeout(r, 400));

    expect(await draftStoreFor('user-c').list()).toEqual([]);
    expect(await loadTodayPointer('user-c')).toBeUndefined();
    expect(peekEngine(id)).toBeUndefined();
    expect(calls).toEqual([]);
    expect(await draftStoreFor('user-d').list()).toHaveLength(1);
    expect(await loadTodayPointer('user-d')).toBeDefined();
  });
});

describe('last-moment rescue (the page goes away mid-sentence)', () => {
  const rescueKey = (user: string, id: string) => `solace:rescue:${user}:${id}`;

  it('keeps words typed just before unload, though the device draft never caught up', async () => {
    const id = 'eeeeeeee-0000-4000-8000-000000000011';
    const store = draftStoreFor('user-r');
    const before = mk(id, 'first words', { updatedAt: 1 });
    await store.save(before); // what reached IndexedDB earlier
    const engine = acquireEngine('user-r', before);
    engine.edit({ body: 'first words and the last ones' }); // the local debounce hasn't fired
    rescueAllEngines(); // pagehide: synchronous
    // The page dies here: its engines stop and no asynchronous write completes.
    await forgetUserOnDevice('user-r', { keepUnsyncedDrafts: true });
    expect(localStorage.getItem(rescueKey('user-r', id))).not.toBeNull();

    // Next load: the rescued words win and move into the store.
    const loaded = await store.load(id);
    expect(loaded?.fields.body).toBe('first words and the last ones');
    expect(localStorage.getItem(rescueKey('user-r', id))).toBeNull();
    expect((await store.list()).map((d) => d.fields.body)).toEqual(['first words and the last ones']);
    await store.remove(id);
  });

  it('never lets an older rescued copy override a newer device draft, and clears it on save', async () => {
    const id = 'eeeeeeee-0000-4000-8000-000000000012';
    const store = draftStoreFor('user-r');
    rescueDraft('user-r', mk(id, 'old', { updatedAt: 5 }));
    await store.save(mk(id, 'newer', { updatedAt: 10 }));
    expect(localStorage.getItem(rescueKey('user-r', id))).toBeNull();

    rescueDraft('user-r', mk(id, 'stale', { updatedAt: 7 }));
    expect((await store.load(id))?.fields.body).toBe('newer');
    expect(localStorage.getItem(rescueKey('user-r', id))).toBeNull();

    // A save of an older state never drops a rescue holding a later edit.
    rescueDraft('user-r', mk(id, 'latest', { updatedAt: 20 }));
    await store.save(mk(id, 'newer', { updatedAt: 10 }));
    expect(localStorage.getItem(rescueKey('user-r', id))).not.toBeNull();
    expect((await store.load(id))?.fields.body).toBe('latest');
    await store.remove(id);
  });

  it('only rescues engines with unsaved words, and forgetting the account erases rescued copies', async () => {
    const id = 'eeeeeeee-0000-4000-8000-000000000013';
    const engine = acquireEngine('user-s', mk(id, 'unsent'));
    rescueAllEngines();
    expect(localStorage.getItem(rescueKey('user-s', id))).not.toBeNull();
    await forgetUserOnDevice('user-s');
    expect(localStorage.getItem(rescueKey('user-s', id))).toBeNull();
    expect(await draftStoreFor('user-s').list()).toEqual([]);
    expect(engine.rescueDraft()).toBeNull(); // disposed
  });
});
