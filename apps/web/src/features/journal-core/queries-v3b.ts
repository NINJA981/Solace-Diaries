/**
 * TanStack Query hooks for the v3 Insights and Reflect features: Unwrapped, mood patterns,
 * growth notes, intentions (Threads), life chapters and letters from your past self.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Chapter,
  ChapterList,
  CorrelationList,
  CreateIntentionInput,
  Entry,
  GrowthNote,
  Intention,
  PastLetter,
  PastLetterList,
  Thread,
  ThreadMode,
  ThreadWithMessages,
  Unwrapped,
  UpdateIntentionInput,
} from '@solace/shared';
import { api, ApiRequestError } from '@/lib/api';
import { invalidateEntryDerived, qk } from './queries';

export type { Chapter };

export const qk3 = {
  unwrapped: (period: 'month' | 'year', at: string, tz: string) => ['unwrapped', period, at, tz] as const,
  correlations: (tz: string) => ['correlations', tz] as const,
  growth: ['growth'] as const,
  intentions: ['intentions'] as const,
  suggestions: ['intentions', 'suggestions'] as const,
  chapters: ['chapters'] as const,
  letters: ['letters'] as const,
};

const noRetryOn4xx = (count: number, err: unknown) =>
  !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) &&
  count < 2;

// ───────────────────────── Unwrapped / patterns / growth ─────────────────────────

export function useUnwrapped(period: 'month' | 'year', at: string, tz: string) {
  return useQuery({
    queryKey: qk3.unwrapped(period, at, tz),
    queryFn: ({ signal }) => api.unwrapped({ query: { period, at, tz }, signal }) as Promise<Unwrapped>,
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

export function useCorrelations(tz: string) {
  return useQuery({
    queryKey: qk3.correlations(tz),
    queryFn: ({ signal }) => api.correlations({ query: { tz }, signal }) as Promise<CorrelationList>,
    staleTime: 5 * 60_000,
    retry: noRetryOn4xx,
  });
}

export function useLatestGrowthNote() {
  return useQuery({
    queryKey: qk3.growth,
    queryFn: ({ signal }) => api.listGrowthNotes({ signal }) as Promise<{ items: GrowthNote[] }>,
    select: (d) => d.items[0] ?? null,
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

// ───────────────────────── intentions ─────────────────────────

export function useIntentions() {
  return useQuery({
    queryKey: qk3.intentions,
    queryFn: ({ signal }) => api.listIntentions({ signal }) as Promise<{ items: Intention[] }>,
    select: (d) => d.items,
    retry: noRetryOn4xx,
  });
}

export function useIntentionSuggestions() {
  return useQuery({
    queryKey: qk3.suggestions,
    queryFn: ({ signal }) =>
      api.intentionSuggestions({ signal }) as Promise<{ items: { memoryId: string; title: string; kind: 'habit' | 'goal' }[] }>,
    select: (d) => d.items,
    staleTime: 5 * 60_000,
    retry: noRetryOn4xx,
  });
}

function replaceIntention(items: Intention[] | undefined, next: Intention): Intention[] {
  const list = items ?? [];
  return list.some((i) => i.id === next.id) ? list.map((i) => (i.id === next.id ? next : i)) : [next, ...list];
}

export function useCreateIntention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIntentionInput) => api.createIntention({ body }) as Promise<Intention>,
    onSuccess: (i) => {
      qc.setQueryData<{ items: Intention[] }>(qk3.intentions, (d) => ({ items: replaceIntention(d?.items, i) }));
      void qc.invalidateQueries({ queryKey: qk3.suggestions });
    },
  });
}

export function useUpdateIntention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateIntentionInput }) =>
      api.updateIntention({ params: { id }, body: patch }) as Promise<Intention>,
    onSuccess: (i) => qc.setQueryData<{ items: Intention[] }>(qk3.intentions, (d) => ({ items: replaceIntention(d?.items, i) })),
  });
}

export function useDeleteIntention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteIntention({ params: { id } }) as Promise<void>,
    onSuccess: (_d, id) =>
      qc.setQueryData<{ items: Intention[] }>(qk3.intentions, (d) => ({ items: (d?.items ?? []).filter((i) => i.id !== id) })),
  });
}

/** Check in or undo a day. Optimistic: the week strip responds at once and rolls back on error. */
export function useToggleCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date, on }: { id: string; date: string; on: boolean }) =>
      (on
        ? api.checkIn({ params: { id }, body: { date } })
        : api.undoCheckIn({ params: { id, date } })) as Promise<Intention>,
    onMutate: async ({ id, date, on }) => {
      await qc.cancelQueries({ queryKey: qk3.intentions });
      const prev = qc.getQueryData<{ items: Intention[] }>(qk3.intentions);
      qc.setQueryData<{ items: Intention[] }>(qk3.intentions, (d) => ({
        items: (d?.items ?? []).map((i) =>
          i.id !== id
            ? i
            : {
                ...i,
                checkins: on
                  ? i.checkins.some((c) => c.date === date)
                    ? i.checkins
                    : [{ date, note: null }, ...i.checkins]
                  : i.checkins.filter((c) => c.date !== date),
              },
        ),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk3.intentions, ctx.prev);
    },
    onSuccess: (i) => qc.setQueryData<{ items: Intention[] }>(qk3.intentions, (d) => ({ items: replaceIntention(d?.items, i) })),
  });
}

// ───────────────────────── chapters ─────────────────────────

export function useChapters(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk3.chapters,
    queryFn: ({ signal }) => api.listChapters({ signal }) as Promise<ChapterList>,
    refetchInterval: opts.poll ? 4000 : false,
    retry: noRetryOn4xx,
  });
}

export function useRefreshChapters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshChapters() as Promise<ChapterList>,
    onSuccess: (d) => qc.setQueryData(qk3.chapters, d),
  });
}

// ───────────────────────── letters ─────────────────────────

export function useLetters() {
  return useQuery({
    queryKey: qk3.letters,
    queryFn: ({ signal }) => api.listLetters({ signal }) as Promise<PastLetterList>,
    retry: noRetryOn4xx,
  });
}

export function useWriteLetter(tz: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.writeLetter({ query: { tz } }) as Promise<PastLetter>,
    onSuccess: (letter) => {
      qc.setQueryData<PastLetterList>(qk3.letters, (d) =>
        d ? { ...d, items: [letter, ...d.items.filter((l) => l.id !== letter.id)], canWrite: false } : d,
      );
      void qc.invalidateQueries({ queryKey: qk3.letters });
    },
  });
}

export function useReplyToLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.replyToLetter({ params: { id }, body: { body } }) as Promise<Entry>,
    onSuccess: (entry, { id }) => {
      qc.setQueryData<PastLetterList>(qk3.letters, (d) =>
        d ? { ...d, items: d.items.map((l) => (l.id === id ? { ...l, replyEntryId: entry.id } : l)) } : d,
      );
      invalidateEntryDerived(qc);
    },
  });
}

// ───────────────────────── guided reflections ─────────────────────────

/** Creates a thread, optionally in a guided mode. Same cache updates as the plain create. */
export function useCreateModeThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; mode?: ThreadMode }) => api.createThread({ body }) as Promise<Thread>,
    onSuccess: (t) => {
      qc.setQueryData<ThreadWithMessages>(qk.thread(t.id), { ...t, messages: [] });
      qc.setQueryData<{ items: Thread[] }>(qk.threads, (d) => (d ? { items: [t, ...d.items] } : d));
      void qc.invalidateQueries({ queryKey: qk.threads });
    },
  });
}
