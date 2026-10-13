/**
 * One EntrySync per entry id for the whole app, so the editor, the background flusher and
 * a just-unmounted editor finishing its last write never race each other (single flight
 * per entry, globally).
 */
import type { Entry } from '@solace/shared';
import { api, ApiRequestError } from '@/lib/api';
import { createDraftStore } from './draftStore';
import { EntrySync, type Draft, type DraftStore, type EngineDeps, type Transport } from './syncEngine';

export const apiTransport: Transport = {
  create: (input) => api.createEntry({ body: input }) as Promise<Entry>,
  update: (id, patch, version) =>
    api.updateEntry({ params: { id }, body: patch, headers: { 'If-Match': String(version) } }) as Promise<Entry>,
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

/** Flush every live engine right now (pagehide). Best effort: the draft is already local. */
export function flushAllEngines(): void {
  for (const { engine } of slots.values()) void engine.flush();
}

/**
 * Throw away an entry's local state (it is being deleted): stop its engine without the
 * final flush and drop the device draft.
 */
export async function discardEntryLocally(userId: string, id: string): Promise<void> {
  const slot = slots.get(id);
  if (slot) {
    slot.engine.dispose();
    slots.delete(id);
  }
  try {
    await draftStoreFor(userId).remove(id);
  } catch {
    /* storage unavailable */
  }
}
