import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { loadTodayPointer, saveTodayPointer } from '../journal-core/editor/draftStore';

export type TodayEntry = { id: string; isNew: boolean; promptId?: string };

/**
 * Which entry Today's editor writes into. The id is generated on the client up front
 * (idempotent create) and remembered per local date, so coming back to Today continues
 * the entry started earlier instead of creating a duplicate.
 */
export function useTodayEntry(today: string) {
  const { userId } = useSession();
  const [current, setCurrent] = useState<TodayEntry | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadTodayPointer(userId)
      .catch(() => undefined)
      .then((p) => {
        if (!alive) return;
        if (p && p.date === today) {
          setCurrent({ id: p.id, isNew: false, promptId: p.promptId });
        } else {
          const id = crypto.randomUUID();
          void saveTodayPointer(userId, { date: today, id });
          setCurrent({ id, isNew: true });
        }
      });
    return () => {
      alive = false;
    };
  }, [userId, today]);

  const startNew = useCallback(
    (promptId?: string): string | null => {
      if (!userId) return null;
      const id = crypto.randomUUID();
      void saveTodayPointer(userId, { date: today, id, promptId });
      setCurrent({ id, isNew: true, promptId });
      return id;
    },
    [userId, today],
  );

  return { current, startNew };
}
