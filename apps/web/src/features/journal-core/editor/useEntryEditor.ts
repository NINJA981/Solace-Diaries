import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Entry } from '@solace/shared';
import { useSession } from '@/lib/session';
import { invalidateEntryDerived, isNotFound, qk, useEntry } from '../queries';
import { acquireEngine, draftStoreFor, flushAllEngines, releaseEngine, rescueAllEngines, setSavedListener } from './registry';
import { emptyFields, fieldsFromEntry, type Draft, type EngineSnapshot, type EntrySync } from './syncEngine';

let listInvalidateTimer: ReturnType<typeof setTimeout> | null = null;

/** Keep the query cache in step with autosaves without refetching lists on every keystroke. */
function installCacheBridge(qc: QueryClient) {
  setSavedListener((entry: Entry, created: boolean) => {
    qc.setQueryData<Entry>(qk.entry(entry.id), (prev) =>
      // PATCH responses carry fresh data; keep attachment URLs we already have if absent.
      prev ? { ...prev, ...entry, attachments: entry.attachments ?? prev.attachments } : entry,
    );
    if (created) {
      invalidateEntryDerived(qc);
      void qc.invalidateQueries({ queryKey: ['prompt'] });
      return;
    }
    if (listInvalidateTimer) clearTimeout(listInvalidateTimer);
    listInvalidateTimer = setTimeout(() => invalidateEntryDerived(qc), 4000);
  });
}

export function draftFromEntry(e: Entry): Draft {
  const f = fieldsFromEntry(e);
  return { id: e.id, fields: f, synced: f, version: e.version, updatedAt: Date.now() };
}

export function freshDraft(id: string, entryDate: string, promptId?: string): Draft {
  return { id, fields: emptyFields(entryDate), synced: null, version: null, promptId, updatedAt: Date.now() };
}

export type EditorLoad =
  | { state: 'loading' }
  | { state: 'ready'; engine: EntrySync }
  | { state: 'notFound' }
  | { state: 'error'; error: unknown; retry: () => void };

type Options = {
  /** Fetch the server copy (false for an id we just generated). */
  fetchServer: boolean;
  /** A 404 means "not created yet" rather than "missing" (Today's pointer). */
  allowMissing: boolean;
  /** Entry date for a brand-new entry. */
  entryDate: string;
  promptId?: string;
};

/**
 * Wires an entry id to its autosave engine: local draft (if any) wins over the server copy,
 * since it holds words the server hasn't acknowledged; fresher server copies (enrichment
 * polling) are offered to the engine to merge.
 */
export function useEntryEditor(id: string, opts: Options) {
  const qc = useQueryClient();
  const { userId } = useSession();
  const [local, setLocal] = useState<{ key: string; draft: Draft | undefined } | null>(null);
  const [engine, setEngine] = useState<EntrySync | null>(null);
  const key = `${userId}:${id}`;
  // Ids whose entry exists server-side (enables fetching + enrichment polling).
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => installCacheBridge(qc), [qc]);

  // 1. Device draft.
  useEffect(() => {
    if (!userId || !id) return;
    let alive = true;
    draftStoreFor(userId)
      .load(id)
      .catch(() => undefined)
      .then((draft) => alive && setLocal({ key, draft }));
    return () => {
      alive = false;
    };
  }, [userId, id, key]);

  // 2. Server copy (enabled once it exists; polls while enrichment runs).
  const live = engine && engine.id === id ? engine : null;
  const isCreated = useEngineSelector(live, (s) => s.version !== null) === true;
  if (isCreated && createdId !== id) setCreatedId(id);
  const created = isCreated || createdId === id;
  const query = useEntry(id, { enabled: opts.fetchServer || created });
  const localReady = local?.key === key;
  const serverSettled = !opts.fetchServer || query.isSuccess || query.isError;
  const missing = query.isError && isNotFound(query.error);
  const hardError = query.isError && !missing;
  const hasDraft = !!local?.draft;
  const canStartNow =
    !!userId &&
    !!id && localReady && serverSettled && (hasDraft || !hardError) && (hasDraft || !missing || opts.allowMissing);
  // Latch: once the editor is live, a later failed refetch must never tear it down mid-sentence.
  const [startedKey, setStartedKey] = useState<string | null>(null);
  if (canStartNow && startedKey !== key) setStartedKey(key);
  const canStart = canStartNow || startedKey === key;

  // Read the latest server copy/options when the engine starts, without restarting it.
  const initialDraft = useEffectEvent((): Draft => {
    if (local?.draft) return local.draft;
    if (query.data && query.data.id === id) return draftFromEntry(query.data);
    return freshDraft(id, opts.entryDate, opts.promptId);
  });

  // 3. Engine.
  useEffect(() => {
    if (!canStart || !userId) return;
    const eng = acquireEngine(userId, initialDraft());
    // Acquiring the shared, ref-counted engine is a side effect; React only holds its handle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(eng);
    return () => {
      setEngine(null);
      releaseEngine(id);
    };
  }, [canStart, userId, id]);

  // Fresher server copies → merge.
  useEffect(() => {
    if (engine && query.data && query.data.id === engine.id) engine.adoptServer(query.data);
  }, [engine, query.data]);

  // Leaving the page or hiding the tab stashes unsaved words synchronously, then flushes
  // immediately, with keepalive so a small write can finish after the page is gone.
  useEffect(() => {
    // The synchronous rescue comes first: the asynchronous writes may never finish.
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      rescueAllEngines();
      flushAllEngines({ keepalive: true });
    };
    const onPageHide = () => {
      rescueAllEngines();
      flushAllEngines({ keepalive: true });
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Pages subscribe to primitives only; the Editor itself subscribes to the full snapshot,
  // so typing re-renders the writing surface and nothing else.

  let load: EditorLoad;
  if (engine && engine.id === id) load = { state: 'ready', engine };
  else if (localReady && serverSettled && missing && !hasDraft && !opts.allowMissing) load = { state: 'notFound' };
  else if (localReady && serverSettled && hardError && !hasDraft)
    load = { state: 'error', error: query.error, retry: () => void query.refetch() };
  else load = { state: 'loading' };

  return { load, engine: live, server: query.data?.id === id ? query.data : undefined };
}

const noop = () => () => {};
const nullSnap = () => null;

export function useEngineSnapshot(engine: EntrySync | null): EngineSnapshot | null {
  return useSyncExternalStore(engine ? engine.subscribe : noop, engine ? engine.getSnapshot : nullSnap, engine ? engine.getSnapshot : nullSnap);
}

/** Subscribe to one derived primitive of the engine state (re-renders only when it changes). */
export function useEngineSelector<T extends string | number | boolean | null>(
  engine: EntrySync | null,
  select: (s: EngineSnapshot) => T,
): T | null {
  const get = () => (engine ? select(engine.getSnapshot()) : null);
  return useSyncExternalStore(engine ? engine.subscribe : noop, get, get);
}
