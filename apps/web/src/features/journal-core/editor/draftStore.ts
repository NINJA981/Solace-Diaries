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

// ───────── last-moment rescue ─────────
// IndexedDB writes are asynchronous and are dropped when the page is torn down (reload, tab
// closed), so words typed in the last moments before `pagehide` would be lost. The page then
// also writes its unsynced drafts synchronously to localStorage; the next load adopts them
// into the store, and any later save/remove of the same draft clears them.

const rescuePrefix = (userId: string) => `solace:rescue:${userId}:`;
const rescueKey = (userId: string, id: string) => `${rescuePrefix(userId)}${id}`;

function local(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readRescue(key: string): Draft | null {
  try {
    const d = JSON.parse(local()?.getItem(key) ?? 'null') as Draft | null;
    return d && typeof d.id === 'string' && d.fields ? d : null;
  } catch {
    return null;
  }
}

function rescueKeys(userId: string): string[] {
  const s = local();
  if (!s) return [];
  const prefix = rescuePrefix(userId);
  const out: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) out.push(k);
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/** Synchronously stash a draft that may not reach IndexedDB before the page goes away. */
export function rescueDraft(userId: string, draft: Draft): void {
  try {
    local()?.setItem(rescueKey(userId, draft.id), JSON.stringify(draft));
  } catch {
    /* quota or private mode: the async paths are all that's left */
  }
}

/** Drop a rescued copy unless it holds an edit made after `notAfter` (epoch ms). */
function dropRescue(userId: string, id: string, notAfter: number): void {
  const key = rescueKey(userId, id);
  const rescued = readRescue(key);
  if (rescued && (rescued.updatedAt ?? 0) > notAfter) return;
  try {
    local()?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Move rescued drafts into the store, keeping whichever copy of each is newer. */
async function adoptRescued(userId: string): Promise<void> {
  for (const key of rescueKeys(userId)) {
    const rescued = readRescue(key);
    if (rescued) {
      const k = draftKey(userId, rescued.id);
      const current = await rawGet<Draft>(k);
      if (!current || (rescued.updatedAt ?? 0) >= (current.updatedAt ?? 0)) {
        try {
          await rawSet(k, rescued);
        } catch {
          continue; // keep the rescued copy for next time
        }
      }
    }
    try {
      local()?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}

export function createDraftStore(userId: string): DraftStore {
  const prefix = `draft:${userId}:`;
  return {
    load: async (id) => {
      await adoptRescued(userId);
      return rawGet<Draft>(draftKey(userId, id));
    },
    save: async (draft) => {
      await rawSet(draftKey(userId, draft.id), draft);
      dropRescue(userId, draft.id, draft.updatedAt);
    },
    remove: async (id) => {
      const at = Date.now();
      await rawDel(draftKey(userId, id));
      dropRescue(userId, id, at);
    },
    list: async () => {
      await adoptRescued(userId);
      return (await rawEntries())
        .filter(([k]) => typeof k === 'string' && k.startsWith(prefix))
        .map(([, v]) => v as Draft);
    },
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
  for (const k of rescueKeys(userId)) {
    try {
      local()?.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  }
  await Promise.all([...keys].map((k) => rawDel(k)));
}
