import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateEntryInput, Entry, UpdateEntryInput } from '@solace/shared';
import { EntrySync, emptyFields, type Draft, type DraftStore, type Transport } from './syncEngine';

const ID = '11111111-1111-4111-8111-111111111111';

function entryFrom(id: string, f: Partial<Entry> & { version: number }): Entry {
  return {
    id,
    title: '',
    body: '',
    entryDate: '2026-10-13',
    mood: null,
    moodSource: null,
    tags: [],
    summary: null,
    wordCount: 0,
    enrichmentStatus: 'pending',
    attachments: [],
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    ...f,
  };
}

type Call =
  | { kind: 'create'; input: CreateEntryInput; keepalive?: boolean }
  | { kind: 'update'; patch: UpdateEntryInput; version: number; keepalive?: boolean }
  | { kind: 'get' };

/** In-memory server with optional manual gating of responses. */
function fakeServer() {
  let current: Entry | null = null;
  const calls: Call[] = [];
  let gate: Promise<void> | null = null;
  let failNext: unknown[] = [];
  let lose = 0;
  const transport: Transport = {
    async create(input, opts) {
      calls.push(opts?.keepalive ? { kind: 'create', input, keepalive: true } : { kind: 'create', input });
      if (gate) await gate;
      if (failNext.length) throw failNext.shift();
      // Like the API: an id that already exists returns the stored row (200), untouched.
      const created = !current;
      if (!current) {
        current = entryFrom(input.id!, {
          version: 1,
          title: input.title ?? '',
          body: input.body ?? '',
          tags: input.tags ?? [],
          mood: input.mood ?? null,
          moodSource: input.mood ? 'user' : null,
        });
      }
      if (lose > 0) {
        // The write landed but the response never arrived.
        lose--;
        throw new TypeError('Failed to fetch');
      }
      return { entry: current, created };
    },
    async update(_id, patch, version, opts) {
      calls.push(opts?.keepalive ? { kind: 'update', patch, version, keepalive: true } : { kind: 'update', patch, version });
      if (gate) await gate;
      if (failNext.length) throw failNext.shift();
      if (!current) throw { status: 404, code: 'not_found', message: 'gone' };
      if (version !== current.version) throw { status: 409, code: 'version_conflict', message: 'stale' };
      current = {
        ...current,
        ...patch,
        moodSource: 'mood' in patch ? (patch.mood ? 'user' : null) : current.moodSource,
        version: current.version + 1,
      } as Entry;
      return current;
    },
    async get() {
      calls.push({ kind: 'get' });
      return current;
    },
  };
  return {
    transport,
    calls,
    get entry() {
      return current;
    },
    set entry(e: Entry | null) {
      current = e;
    },
    hold() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    failWith(...errs: unknown[]) {
      failNext = errs;
    },
    /** The next `n` creates reach the server but their responses are lost. */
    loseResponses(n: number) {
      lose = n;
    },
  };
}

function memoryStore(): DraftStore & { data: Map<string, Draft> } {
  const data = new Map<string, Draft>();
  return {
    data,
    load: async (id) => data.get(id),
    save: async (d) => void data.set(d.id, structuredClone(d)),
    remove: async (id) => void data.delete(id),
    list: async () => [...data.values()],
  };
}

function newDraft(): Draft {
  return { id: ID, fields: emptyFields('2026-10-13'), synced: null, version: null, updatedAt: 0 };
}

describe('EntrySync', () => {
  let online = true;
  beforeEach(() => {
    vi.useFakeTimers();
    online = true;
  });
  afterEach(() => vi.useRealTimers());

  function setup(draft = newDraft(), server = fakeServer()) {
    const store = memoryStore();
    const engine = new EntrySync(draft, {
      transport: server.transport,
      store,
      isOnline: () => online,
      retryDelaysMs: [1000, 2000],
    });
    return { server, store, engine };
  }

  it('does not create anything for an untouched new entry', async () => {
    const { server, engine } = setup();
    await engine.flush();
    expect(server.calls).toHaveLength(0);
    expect(engine.getSnapshot().status).toBe('empty');
  });

  it('persists locally first, then creates with the client id, then patches changed fields with If-Match', async () => {
    const { server, store, engine } = setup();
    engine.edit({ body: 'Dear diary' });
    expect(engine.getSnapshot().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(300);
    expect(store.data.get(ID)?.fields.body).toBe('Dear diary');
    expect(server.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1200);
    expect(server.calls).toEqual([
      { kind: 'create', input: { id: ID, title: '', body: 'Dear diary', entryDate: '2026-10-13' } },
    ]);
    expect(engine.getSnapshot().status).toBe('saved');
    expect(engine.getSnapshot().version).toBe(1);
    expect(store.data.has(ID)).toBe(false);

    engine.edit({ title: 'Monday' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.calls[1]).toEqual({ kind: 'update', patch: { title: 'Monday' }, version: 1 });
    expect(engine.getSnapshot().version).toBe(2);
    expect(engine.getSnapshot().status).toBe('saved');
  });

  it('debounces: rapid typing produces a single write', async () => {
    const { server, engine } = setup();
    for (const ch of 'hello') {
      engine.edit({ body: (engine.getSnapshot().fields.body ?? '') + ch });
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.calls).toHaveLength(1);
    expect(server.entry?.body).toBe('hello');
  });

  it('is single-flight: edits during an in-flight write coalesce into one follow-up write', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'one' });
    const release = server.hold();
    const first = engine.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(1);

    engine.edit({ body: 'one two' });
    void engine.flush();
    engine.edit({ body: 'one two three' });
    void engine.flush();
    await vi.advanceTimersByTimeAsync(5000);
    // Still only the original request while it hangs.
    expect(server.calls).toHaveLength(1);
    expect(engine.getSnapshot().status).toBe('saving');

    release();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.map((c) => c.kind)).toEqual(['create', 'update']);
    expect(server.calls[1]).toEqual({ kind: 'update', patch: { body: 'one two three' }, version: 1 });
    expect(server.entry?.body).toBe('one two three');
    expect(engine.getSnapshot().status).toBe('saved');
  });

  it('on 409 with an unchanged server body, rebases onto the new version and retries', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'first' });
    await engine.flush();
    // Enrichment bumped the version and set AI mood/tags.
    server.entry = { ...server.entry!, version: 5, mood: 'calm', moodSource: 'ai', tags: ['work'] };

    engine.edit({ body: 'first, then more' });
    await engine.flush();
    const kinds = server.calls.map((c) => c.kind);
    expect(kinds).toEqual(['create', 'update', 'get', 'update']);
    expect(server.calls[3]).toEqual({ kind: 'update', patch: { body: 'first, then more' }, version: 5 });
    const snap = engine.getSnapshot();
    expect(snap.status).toBe('saved');
    expect(snap.version).toBe(6);
    // AI metadata adopted, user's text kept.
    expect(snap.fields.mood).toBe('calm');
    expect(snap.fields.tags).toEqual(['work']);
    expect(snap.fields.body).toBe('first, then more');
  });

  it('on 409 with a diverged server body, stops and asks; "keep mine" overwrites, never dropping text', async () => {
    const { server, store, engine } = setup();
    engine.edit({ body: 'from this device' });
    await engine.flush();
    server.entry = { ...server.entry!, version: 3, body: 'from the other tab' };

    engine.edit({ body: 'from this device, continued' });
    await engine.flush();
    let snap = engine.getSnapshot();
    expect(snap.status).toBe('conflict');
    expect(snap.conflict).toMatchObject({ kind: 'diverged', server: { body: 'from the other tab' } });
    expect(store.data.get(ID)?.fields.body).toBe('from this device, continued');

    // Further typing is kept locally but not sent.
    const before = server.calls.length;
    engine.edit({ body: 'from this device, continued!' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.calls.length).toBe(before);

    await engine.resolveConflict('mine');
    snap = engine.getSnapshot();
    expect(snap.status).toBe('saved');
    expect(server.entry?.body).toBe('from this device, continued!');
    expect(server.calls.at(-1)).toMatchObject({ kind: 'update', version: 3 });
  });

  it('"use the other version" replaces the screen and clears the draft', async () => {
    const { server, store, engine } = setup();
    engine.edit({ body: 'mine' });
    await engine.flush();
    server.entry = { ...server.entry!, version: 4, body: 'theirs' };
    engine.edit({ body: 'mine 2' });
    await engine.flush();
    expect(engine.getSnapshot().status).toBe('conflict');
    await engine.resolveConflict('theirs');
    expect(engine.getSnapshot().fields.body).toBe('theirs');
    expect(engine.getSnapshot().status).toBe('saved');
    expect(store.data.has(ID)).toBe(false);
  });

  it('offline: keeps the draft on the device and syncs once back online', async () => {
    const { server, store, engine } = setup();
    online = false;
    engine.edit({ body: 'written on a plane' });
    await engine.flush();
    expect(engine.getSnapshot().status).toBe('offline');
    expect(server.calls).toHaveLength(0);
    expect(store.data.get(ID)?.fields.body).toBe('written on a plane');

    online = true;
    await engine.sync();
    expect(server.entry?.body).toBe('written on a plane');
    expect(engine.getSnapshot().status).toBe('saved');
    expect(store.data.has(ID)).toBe(false);
  });

  it('network failure → retries with backoff without duplicating the create', async () => {
    const { server, engine } = setup();
    server.failWith(new TypeError('Failed to fetch'), { status: 503, message: 'down' });
    engine.edit({ body: 'retry me' });
    await engine.flush();
    expect(engine.getSnapshot().status).toBe('retrying');
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.getSnapshot().status).toBe('retrying');
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot().status).toBe('saved');
    // All three attempts were POSTs with the same client id → idempotent server-side.
    expect(server.calls.map((c) => c.kind)).toEqual(['create', 'create', 'create']);
    expect(new Set(server.calls.map((c) => (c.kind === 'create' ? c.input.id : '')))).toEqual(new Set([ID]));
  });

  it('validation errors stop retrying and surface a message', async () => {
    const { server, engine } = setup();
    server.failWith({ status: 400, message: 'Too long' });
    engine.edit({ body: 'x' });
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({ status: 'failed', error: 'Too long' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.calls).toHaveLength(1);
  });

  it('a deleted entry (404 on PATCH) becomes a conflict; "keep mine" re-creates it', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'keep' });
    await engine.flush();
    server.entry = null;
    engine.edit({ body: 'keep this' });
    await engine.flush();
    expect(engine.getSnapshot().conflict).toEqual({ kind: 'deleted' });
    await engine.resolveConflict('mine');
    expect((server.entry as Entry | null)?.body).toBe('keep this');
    expect(engine.getSnapshot().status).toBe('saved');
  });

  it('accepting the AI mood sends mood even though the value is unchanged', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'calm day' });
    await engine.flush();
    server.entry = { ...server.entry!, version: 2, mood: 'calm', moodSource: 'ai' };
    engine.adoptServer(server.entry);
    expect(engine.getSnapshot().fields).toMatchObject({ mood: 'calm', moodSource: 'ai' });
    expect(engine.getSnapshot().status).toBe('saved');

    engine.edit({ mood: 'calm' });
    await engine.flush();
    expect(server.calls.at(-1)).toEqual({ kind: 'update', patch: { mood: 'calm' }, version: 2 });
    expect(server.entry?.moodSource).toBe('user');
  });

  it('adoptServer leaves unsynced local text alone when the server text changed', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'a' });
    await engine.flush();
    engine.edit({ body: 'ab' });
    engine.adoptServer({ ...server.entry!, version: 9, body: 'zzz' });
    expect(engine.getSnapshot().fields.body).toBe('ab');
    expect(engine.getSnapshot().version).toBe(1);
  });

  it('ensureCreated creates an empty entry on demand (for photo uploads)', async () => {
    const { server, engine } = setup();
    expect(await engine.ensureCreated()).toBe(true);
    expect(server.calls[0]).toMatchObject({ kind: 'create', input: { id: ID } });
    expect(engine.getSnapshot().status).toBe('saved');
  });

  it('sends promptId on create only', async () => {
    const { server, engine } = setup();
    engine.setPromptId('22222222-2222-4222-8222-222222222222');
    engine.edit({ body: '> A prompt\n\n' });
    await engine.flush();
    expect(server.calls[0]).toMatchObject({
      kind: 'create',
      input: { promptId: '22222222-2222-4222-8222-222222222222' },
    });
  });
  describe('a create that returns an existing row is not an acknowledgement', () => {
    it('lost-response retry: the server holds our older text → rebase and PATCH the newer text', async () => {
      const { server, store, engine } = setup();
      server.loseResponses(1);
      engine.edit({ body: 'first thoughts' });
      await engine.flush();
      expect(engine.getSnapshot().status).toBe('retrying');
      expect(server.entry?.body).toBe('first thoughts');

      engine.edit({ body: 'first thoughts, and then a lot more' });
      await engine.flush();
      expect(server.calls.map((c) => c.kind)).toEqual(['create', 'create', 'update']);
      expect(server.calls[2]).toEqual({ kind: 'update', patch: { body: 'first thoughts, and then a lot more' }, version: 1 });
      expect(server.entry?.body).toBe('first thoughts, and then a lot more');
      const snap = engine.getSnapshot();
      expect(snap).toMatchObject({ status: 'saved', dirty: false, version: 2 });
      expect(snap.fields.body).toBe('first thoughts, and then a lot more');
      expect(store.data.has(ID)).toBe(false);
    });

    it('recognises its own earlier text after a reload (history travels with the device draft)', async () => {
      const first = setup();
      first.server.loseResponses(1);
      first.engine.edit({ body: 'before the crash' });
      await first.engine.flush();
      first.engine.edit({ body: 'before the crash, after' });
      await vi.advanceTimersByTimeAsync(300); // persisted locally; the tab then dies
      first.engine.dispose();

      const saved = first.store.data.get(ID)!;
      const second = setup(saved, first.server);
      await second.engine.flush();
      expect(first.server.entry?.body).toBe('before the crash, after');
      expect(second.engine.getSnapshot().status).toBe('saved');
    });

    it('two Today tabs sharing one id: the second creator keeps its text and gets a conflict', async () => {
      const server = fakeServer();
      const tabA = setup(newDraft(), server);
      const tabB = setup(newDraft(), server);
      tabA.engine.edit({ body: 'written in tab A' });
      await tabA.engine.flush();
      tabB.engine.edit({ body: 'written in tab B' });
      await tabB.engine.flush();

      const snap = tabB.engine.getSnapshot();
      expect(snap.status).toBe('conflict');
      expect(snap.conflict).toMatchObject({ kind: 'diverged', server: { body: 'written in tab A' } });
      expect(snap.fields.body).toBe('written in tab B');
      expect(snap.dirty).toBe(true);
      expect(tabB.store.data.get(ID)?.fields.body).toBe('written in tab B');
      expect(server.entry?.body).toBe('written in tab A');

      await tabB.engine.resolveConflict('mine');
      expect(server.calls.at(-1)).toEqual({ kind: 'update', patch: { body: 'written in tab B' }, version: 1 });
      expect(server.entry?.body).toBe('written in tab B');
      expect(tabB.engine.getSnapshot().status).toBe('saved');
    });

    it('"use the other version" after a create conflict adopts the existing row', async () => {
      const server = fakeServer();
      const tabA = setup(newDraft(), server);
      const tabB = setup(newDraft(), server);
      tabA.engine.edit({ body: 'A' });
      await tabA.engine.flush();
      tabB.engine.edit({ body: 'B' });
      await tabB.engine.flush();
      await tabB.engine.resolveConflict('theirs');
      expect(tabB.engine.getSnapshot()).toMatchObject({ status: 'saved', version: 1, dirty: false });
      expect(tabB.engine.getSnapshot().fields.body).toBe('A');
      expect(tabB.store.data.has(ID)).toBe(false);
    });

    it('an existing row with exactly our text is a plain acknowledgement', async () => {
      const server = fakeServer();
      const tabA = setup(newDraft(), server);
      const tabB = setup(newDraft(), server);
      tabA.engine.edit({ body: 'same words' });
      await tabA.engine.flush();
      tabB.engine.edit({ body: 'same words' });
      await tabB.engine.flush();
      expect(tabB.engine.getSnapshot()).toMatchObject({ status: 'saved', version: 1, conflict: null });
      expect(server.calls.map((c) => c.kind)).toEqual(['create', 'create']);
    });

    it('with no local text to lose (photo upload), the existing row is adopted', async () => {
      const server = fakeServer();
      const tabA = setup(newDraft(), server);
      const tabB = setup(newDraft(), server);
      tabA.engine.edit({ body: 'already here' });
      await tabA.engine.flush();
      expect(await tabB.engine.ensureCreated()).toBe(true);
      expect(tabB.engine.getSnapshot()).toMatchObject({ status: 'saved', conflict: null });
      expect(tabB.engine.getSnapshot().fields.body).toBe('already here');
    });

    it('reports the entry as created to the cache only once the rebased text is saved', async () => {
      const server = fakeServer();
      const saved: Array<[string, boolean]> = [];
      const engine = new EntrySync(newDraft(), {
        transport: server.transport,
        store: memoryStore(),
        isOnline: () => online,
        retryDelaysMs: [1000],
        onSaved: (e, created) => saved.push([e.body, created]),
      });
      server.loseResponses(1);
      engine.edit({ body: 'one' });
      await engine.flush();
      engine.edit({ body: 'one two' });
      await engine.flush();
      expect(saved).toEqual([['one two', true]]);
    });
  });

  it('409 where the server holds our own earlier text (a stale snapshot flushed elsewhere) rebases', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'a' });
    await engine.flush();
    engine.edit({ body: 'a b' });
    await vi.advanceTimersByTimeAsync(300); // persisted on the device
    // Another tab flushed that device snapshot first.
    server.entry = { ...server.entry!, version: 2, body: 'a b' };
    engine.edit({ body: 'a b c' });
    await engine.flush();
    expect(server.calls.at(-1)).toEqual({ kind: 'update', patch: { body: 'a b c' }, version: 2 });
    expect(server.entry?.body).toBe('a b c');
    expect(engine.getSnapshot().status).toBe('saved');
  });

  it('flush({ keepalive }) marks the request so it survives the page closing', async () => {
    const { server, engine } = setup();
    engine.edit({ body: 'closing the tab' });
    await engine.flush({ keepalive: true });
    expect(server.calls[0]).toMatchObject({ kind: 'create', keepalive: true });
    engine.edit({ body: 'closing the tab now' });
    await engine.flush();
    expect(server.calls[1]).not.toHaveProperty('keepalive');
  });

  it('dispose + settle: an in-flight first POST lands with no follow-up write or draft, and the engine says it may exist', async () => {
    const { server, store, engine } = setup();
    expect(engine.mayExistOnServer()).toBe(false);
    engine.edit({ body: 'about to delete' });
    const release = server.hold();
    void engine.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.mayExistOnServer()).toBe(true);
    engine.edit({ body: 'about to delete!' });
    store.data.clear();
    engine.dispose();
    const settled = engine.settle();
    release();
    await settled;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(1);
    expect(store.data.size).toBe(0);
  });
});
