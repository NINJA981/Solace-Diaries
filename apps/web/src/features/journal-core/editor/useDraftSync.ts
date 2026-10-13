import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/session';
import { invalidateEntryDerived } from '../queries';
import { draftStoreFor, flushPendingDrafts, peekEngine, syncAllEngines } from './registry';
import type { Draft } from './syncEngine';

/**
 * App-wide offline queue: on start and whenever the browser comes back online, every
 * unsynced draft on this device is pushed to the server. Idempotent per user, so any page
 * can call it (the app shell is the ideal place).
 */
let startedFor: string | null = null;
let pending: Draft[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function run(userId: string, onSynced: () => void) {
  const before = pending.length;
  pending = await flushPendingDrafts(userId);
  emit();
  if (pending.length < before || before === 0) onSynced();
}

export function useDraftSync(): { unsynced: Draft[] } {
  const { userId } = useSession();
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const onSynced = () => invalidateEntryDerived(qc);
    if (startedFor !== userId) {
      startedFor = userId;
      pending = [];
      void run(userId, onSynced);
    }
    const onOnline = () => {
      syncAllEngines();
      void run(userId, onSynced);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [userId, qc]);

  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
  );
  return { unsynced: list };
}

/** Re-read the device drafts (after the open editor saved or a conflict was resolved). */
export function useRefreshUnsynced(trigger: unknown) {
  const { userId } = useSession();
  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      draftStoreFor(userId)
        .list()
        .then((list) => {
          pending = list;
          emit();
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [userId, trigger]);
}

/** Drafts worth offering to restore: unsynced and not open in an editor right now. */
export function restorable(drafts: Draft[], excludeId?: string): Draft[] {
  return drafts
    .filter((d) => d.id !== excludeId && !peekEngine(d.id))
    .filter((d) => d.fields.title.trim() || d.fields.body.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
