/**
 * One EntrySync per entry id for the whole app, so the editor, the background flusher and
 * a just-unmounted editor finishing its last write never race each other (single flight
 * per entry, globally).
 */
import type { Entry } from '@solace/shared';
import { api, ApiRequestError } from '@/lib/api';
import { clearUserDrafts, createDraftStore, rescueDraft } from './draftStore';
import { EntrySync, type Draft, type DraftStore, type EngineDeps, type Transport } from './syncEngine';

/** The API answers a create with 201 + `X-Entry-Created: true`, or 200 + `false` for an existing id. */
function wasCreated(res: Response): boolean {
  const header = res.headers.get('x-entry-created');
  if (header === 'true') return true;
  if (header === 'false') return false;
  return res.status === 201;
}

export const apiTransport: Transport = {
  create: async (input, opts) => {
    let created = false;
    const entry = (await api.createEntry({
      body: input,
      keepalive: opts?.keepalive,
      onResponse: (res) => {
        created = wasCreated(res);
      },
    })) as Entry;
    return { entry, created };
  },
  update: (id, patch, version, opts) =>
    api.updateEntry({
      params: { id },
      body: patch,
      headers: { 'If-Match': String(version) },
      keepalive: opts?.keepalive,
    }) as Promise<Entry>,
  get: async (id) => {
    try {
      return (await api.getEntry({ params: { id } })) as Entry;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) return null;
      throw err;
    }
  },
};

type Slot = { engine: EntrySync; refs: number; userId: string };
const slots = new Map<string, Slot>();
const storeCache = new Map<string, DraftStore>();
/** Entries deleted in this session: the background flusher must never re-create them. */
const discarded = new Set<string>();
let savedListener: ((entry: Entry, created: boolean) => void) | null = null;

export function draftStoreFor(userId: string): DraftStore {
  let s = storeCache.get(userId);
  if (!s) {
    s = createDraftStore(userId);
    storeCache.set(userId, s);
  }
  return s;
}

/** The app wires this to the query cache (set entry data, invalidate lists). */
export function setSavedListener(fn: ((entry: Entry, created: boolean) => void) | null): void {
  savedListener = fn;
}

function deps(userId: string): EngineDeps {
  return {
    transport: apiTransport,
    store: draftStoreFor(userId),
    onSaved: (e, created) => savedListener?.(e, created),
  };
}

export function peekEngine(id: string): EntrySync | undefined {
  return slots.get(id)?.engine;
}

/** Get (or create) the engine for `draft.id` and hold a reference to it. */
export function acquireEngine(userId: string, draft: Draft): EntrySync {
  const existing = slots.get(draft.id);
  if (existing && existing.userId === userId) {
    existing.refs++;
    return existing.engine;
  }
  const engine = new EntrySync(draft, deps(userId));
  slots.set(draft.id, { engine, refs: 1, userId });
  if (engine.isDirty()) void engine.sync();
  return engine;
}

/** Drop a reference; the last one flushes pending text before the engine is disposed. */
export function releaseEngine(id: string): void {
  const slot = slots.get(id);
  if (!slot) return;
  slot.refs--;
  if (slot.refs > 0) return;
  void slot.engine.flush().finally(() => {
    const current = slots.get(id);
    if (current === slot && slot.refs <= 0) {
      slot.engine.dispose();
      slots.delete(id);
    }
  });
}

/**
 * Sync every unsynced draft on this device (app start, coming back online). Engines that
 * are open in an editor are just nudged; others get a temporary engine.
 * Returns the drafts that are still unsynced afterwards.
 */
export async function flushPendingDrafts(userId: string): Promise<Draft[]> {
  const store = draftStoreFor(userId);
  let drafts: Draft[];
  try {
    drafts = await store.list();
  } catch {
    return [];
  }
  await Promise.all(
    drafts.map(async (d) => {
      if (discarded.has(d.id)) return;
      const open = slots.get(d.id);
      if (open) {
        await open.engine.sync();
        return;
      }
      const engine = acquireEngine(userId, d);
      try {
        await engine.sync();
      } finally {
        releaseEngine(d.id);
      }
    }),
  );
  try {
    return await store.list();
  } catch {
    return [];
  }
}

/** Nudge every live engine (e.g. on `online`). */
export function syncAllEngines(): void {
  for (const { engine } of slots.values()) void engine.sync();
}

/**
 * Flush every live engine right now (pagehide, tab hidden). Best effort: the draft is already
 * local. `keepalive` lets small writes finish after the page is gone.
 */
export function flushAllEngines(opts?: { keepalive?: boolean }): void {
  for (const { engine } of slots.values()) void engine.flush(opts);
}

/**
 * Synchronously stash every live engine's unsaved words (pagehide, tab hidden). IndexedDB
 * writes and keepalive requests are asynchronous and may not finish once the page is going
 * away; the next load adopts what was rescued here.
 */
export function rescueAllEngines(): void {
  for (const { engine, userId } of slots.values()) {
    const draft = engine.rescueDraft();
    if (draft) rescueDraft(userId, draft);
  }
}

/**
 * Delete an entry for good, in an order that can't resurrect it:
 *  1. block the background flusher and stop the engine (no timers, retries or follow-ups),
 *  2. drop the device draft (the offline queue item),
 *  3. let any in-flight POST/PATCH land, so the DELETE can't overtake a first save,
 *  4. DELETE on the server whenever a create may have reached it (the API's DELETE is
 *     idempotent, so a row that never landed is fine).
 * If the DELETE fails it throws; calling again retries just the DELETE.
 */
export async function deleteEntryEverywhere(
  userId: string,
  id: string,
  deleteOnServer: (id: string) => Promise<void>,
): Promise<void> {
  discarded.add(id);
  const slot = slots.get(id);
  if (slot) {
    slots.delete(id);
    slot.engine.dispose();
  }
  try {
    await draftStoreFor(userId).remove(id);
  } catch {
    /* storage unavailable */
  }
  if (slot) await slot.engine.settle();
  if (slot && !slot.engine.mayExistOnServer()) return;
  try {
    await deleteOnServer(id);
  } catch (err) {
    // Nothing local is left to resurrect it; let a retry (or a later visit) work normally.
    discarded.delete(id);
    throw err;
  }
}

/**
 * Forget everything this device holds for a user (sign-out, account deletion): stop their
 * engines without a final write, then clear their drafts, offline queue and Today pointer.
 */
export async function forgetUserOnDevice(
  userId: string,
  opts: { keepUnsyncedDrafts?: boolean } = {},
): Promise<void> {
  for (const [id, slot] of slots) {
    if (slot.userId !== userId) continue;
    slots.delete(id);
    slot.engine.dispose();
  }
  // Synced drafts are already gone (an acknowledged save removes its draft), so whatever is
  // left is text the server never received; keep it unless the account itself is gone.
  if (opts.keepUnsyncedDrafts) return;
  try {
    await clearUserDrafts(userId);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Best-effort sync of everything unsaved for a user, bounded by `timeoutMs` (used before an
 * explicit sign-out, while the session is still valid).
 */
export async function flushUserDrafts(userId: string, timeoutMs = 4000): Promise<void> {
  const work = (async () => {
    await Promise.all([...slots.values()].filter((s) => s.userId === userId).map((s) => s.engine.flush()));
    await flushPendingDrafts(userId);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
}
