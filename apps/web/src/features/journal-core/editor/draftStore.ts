/**
 * Device-local draft storage (IndexedDB via idb-keyval), scoped per signed-in user so a
 * shared device never syncs one person's words into another's account. Falls back to
 * memory when IndexedDB is unavailable (some private modes).
 */
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import type { Draft, DraftStore } from './syncEngine';

let idb: UseStore | null | undefined;
const memory = new Map<string, unknown>();

function store(): UseStore | null {
  if (idb === undefined) {
    try {
      idb = typeof indexedDB === 'undefined' ? null : createStore('solace-journal', 'drafts');
    } catch {
      idb = null;
    }
  }
  return idb;
}

async function rawGet<T>(key: string): Promise<T | undefined> {
  const s = store();
  if (!s) return memory.get(key) as T | undefined;
  try {
    return await get<T>(key, s);
  } catch {
    return memory.get(key) as T | undefined;
  }
}

async function rawSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const s = store();
  if (s) await set(key, value, s);
}

async function rawDel(key: string): Promise<void> {
  memory.delete(key);
  const s = store();
  if (s) await del(key, s);
}

async function rawEntries(): Promise<[string, unknown][]> {
  const s = store();
  if (!s) return [...memory.entries()];
  try {
    return (await entries<string, unknown>(s)) as [string, unknown][];
  } catch {
    return [...memory.entries()];
  }
}

const draftKey = (userId: string, id: string) => `draft:${userId}:${id}`;

export function createDraftStore(userId: string): DraftStore {
  const prefix = `draft:${userId}:`;
  return {
    load: (id) => rawGet<Draft>(draftKey(userId, id)),
    save: (draft) => rawSet(draftKey(userId, draft.id), draft),
    remove: (id) => rawDel(draftKey(userId, id)),
    list: async () =>
      (await rawEntries())
        .filter(([k]) => typeof k === 'string' && k.startsWith(prefix))
        .map(([, v]) => v as Draft),
  };
}

/** Which entry the Today editor is working on, per user and local date. */
export type TodayPointer = { date: string; id: string; promptId?: string };

export function loadTodayPointer(userId: string): Promise<TodayPointer | undefined> {
  return rawGet<TodayPointer>(`today:${userId}`);
}

export function saveTodayPointer(userId: string, p: TodayPointer): Promise<void> {
  return rawSet(`today:${userId}`, p).catch(() => undefined);
}

/**
 * Remove everything stored on this device for a user: drafts (the offline queue) and the
 * Today pointer. Other users' data is left alone.
 */
export async function clearUserDrafts(userId: string): Promise<void> {
  const prefix = `draft:${userId}:`;
  const keys = new Set<string>([`today:${userId}`]);
  for (const [k] of await rawEntries()) if (typeof k === 'string' && k.startsWith(prefix)) keys.add(k);
  for (const k of memory.keys()) if (k.startsWith(prefix)) keys.add(k);
  await Promise.all([...keys].map((k) => rawDel(k)));
}
