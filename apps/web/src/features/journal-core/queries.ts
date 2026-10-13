/**
 * TanStack Query hooks for the journaling features. Keys are stable tuples so mutations
 * can invalidate exactly what they change.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Entry,
  EntryPage,
  Graph,
  Memory,
  Mood,
  SearchResult,
  Stats,
  ThreadWithMessages,
  Thread,
  UpdateMemoryInput,
  WeeklyLetterResponse,
  DailyPrompt,
} from '@solace/shared';
import { api, ApiRequestError } from '@/lib/api';

export type EntryFilters = { mood?: Mood; tag?: string; from?: string; to?: string };
export type SearchMode = 'hybrid' | 'keyword';
export type MemoryStatus = 'active' | 'archived';

export const qk = {
  entriesAll: ['entries'] as const,
  entries: (filters: EntryFilters) => ['entries', filters] as const,
  entry: (id: string) => ['entry', id] as const,
  searchAll: ['search'] as const,
  search: (q: string, mode: SearchMode, filters: EntryFilters) => ['search', q, mode, filters] as const,
  threads: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  statsAll: ['stats'] as const,
  stats: (tz: string) => ['stats', tz] as const,
  weeklyAll: ['weekly'] as const,
  weekly: (tz: string) => ['weekly', tz] as const,
  memoriesAll: ['memories'] as const,
  memories: (status: MemoryStatus) => ['memories', status] as const,
  graph: ['graph'] as const,
  prompt: (tz: string) => ['prompt', 'today', tz] as const,
};

/** Drop undefined/empty values so they never reach the query string. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 404;
}

const noRetryOn4xx = (count: number, err: unknown) =>
  !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) &&
  count < 2;

// ───────────────────────── entries ─────────────────────────

export function useEntries(filters: EntryFilters, opts: { limit?: number; enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: qk.entries(filters),
    queryFn: ({ pageParam, signal }) =>
      api.listEntries({
        query: compact({ ...filters, cursor: pageParam, limit: opts.limit ?? 20 }),
        signal,
      }) as Promise<EntryPage>,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EntryPage) => last.nextCursor ?? undefined,
    enabled: opts.enabled ?? true,
    retry: noRetryOn4xx,
  });
}

/** Status values that mean Solace is still reading the entry. */
export function isEnriching(status: Entry['enrichmentStatus'] | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

/**
 * One entry, polled every 3s while AI enrichment is pending/processing. Polling stops when
 * the status settles or the tab is hidden (refetchIntervalInBackground is off).
 */
export function useEntry(id: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.entry(id ?? ''),
    queryFn: ({ signal }) => api.getEntry({ params: { id: id ?? '' }, signal }) as Promise<Entry>,
    enabled: !!id && (opts.enabled ?? true),
    refetchInterval: (q) => (isEnriching(q.state.data?.enrichmentStatus) ? 3000 : false),
    refetchIntervalInBackground: false,
    retry: noRetryOn4xx,
  });
}

/** Lists, search results and stats all derive from entries. */
export function invalidateEntryDerived(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.entriesAll });
  void qc.invalidateQueries({ queryKey: qk.searchAll });
  void qc.invalidateQueries({ queryKey: qk.statsAll });
  void qc.invalidateQueries({ queryKey: qk.weeklyAll });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEntry({ params: { id } }) as Promise<void>,
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.entry(id) });
      invalidateEntryDerived(qc);
      void qc.invalidateQueries({ queryKey: qk.memoriesAll });
      void qc.invalidateQueries({ queryKey: qk.graph });
    },
  });
}

export function useDeleteAttachment(entryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.deleteAttachment({ params: { id: entryId, attachmentId } }) as Promise<void>,
    onSuccess: (_d, attachmentId) => {
      qc.setQueryData<Entry>(qk.entry(entryId), (e) =>
        e ? { ...e, attachments: e.attachments.filter((a) => a.id !== attachmentId) } : e,
      );
      void qc.invalidateQueries({ queryKey: qk.entry(entryId) });
      void qc.invalidateQueries({ queryKey: qk.entriesAll });
    },
  });
}

export function useRetryEnrichment(entryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.retryEnrichment({ params: { id: entryId } }) as Promise<Entry>,
    onSuccess: (entry) => qc.setQueryData(qk.entry(entryId), entry),
  });
}

// ───────────────────────── search ─────────────────────────

export function useSearch(q: string, mode: SearchMode, filters: EntryFilters) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.search(query, mode, filters),
    queryFn: ({ signal }) =>
      api.search({ query: { q: query, mode, limit: 30, ...compact(filters) }, signal }) as Promise<SearchResult>,
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
}

// ───────────────────────── threads ─────────────────────────

export function useThreads() {
  return useQuery({
    queryKey: qk.threads,
    queryFn: ({ signal }) => api.listThreads({ signal }) as Promise<{ items: Thread[] }>,
    select: (d) => d.items,
  });
}

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: qk.thread(id ?? ''),
    queryFn: ({ signal }) => api.getThread({ params: { id: id ?? '' }, signal }) as Promise<ThreadWithMessages>,
    enabled: !!id,
    retry: noRetryOn4xx,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string | undefined) => api.createThread({ body: compact({ title }) }) as Promise<Thread>,
    onSuccess: (t) => {
      qc.setQueryData<ThreadWithMessages>(qk.thread(t.id), { ...t, messages: [] });
      qc.setQueryData<{ items: Thread[] }>(qk.threads, (d) => (d ? { items: [t, ...d.items] } : d));
      void qc.invalidateQueries({ queryKey: qk.threads });
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteThread({ params: { id } }) as Promise<void>,
    onSuccess: (_d, id) => {
      qc.setQueryData<{ items: Thread[] }>(qk.threads, (d) =>
        d ? { items: d.items.filter((t) => t.id !== id) } : d,
      );
      qc.removeQueries({ queryKey: qk.thread(id) });
    },
  });
}

// ───────────────────────── insights ─────────────────────────

export function useStats(tz: string) {
  return useQuery({
    queryKey: qk.stats(tz),
    queryFn: ({ signal }) => api.stats({ query: { tz }, signal }) as Promise<Stats>,
    staleTime: 60_000,
  });
}

export function useWeekly(tz: string) {
  return useQuery({
    queryKey: qk.weekly(tz),
    queryFn: ({ signal }) => api.weekly({ query: { tz }, signal }) as Promise<WeeklyLetterResponse>,
    staleTime: 5 * 60_000,
    retry: noRetryOn4xx,
  });
}

export function useRefreshWeekly(tz: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshWeekly({ query: { tz } }) as Promise<WeeklyLetterResponse>,
    onSuccess: (d) => qc.setQueryData(qk.weekly(tz), d),
  });
}

// ───────────────────────── memories ─────────────────────────

export function useMemories(status: MemoryStatus) {
  return useQuery({
    queryKey: qk.memories(status),
    queryFn: ({ signal }) => api.listMemories({ query: { status }, signal }) as Promise<{ items: Memory[] }>,
    select: (d) => d.items,
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMemoryInput }) =>
      api.updateMemory({ params: { id }, body: patch }) as Promise<Memory>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.memoriesAll });
      void qc.invalidateQueries({ queryKey: qk.graph });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMemory({ params: { id } }) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.memoriesAll });
      void qc.invalidateQueries({ queryKey: qk.graph });
    },
  });
}

export function useGraph() {
  return useQuery({
    queryKey: qk.graph,
    queryFn: ({ signal }) => api.graph({ signal }) as Promise<Graph>,
    staleTime: 5 * 60_000,
  });
}

// ───────────────────────── prompts ─────────────────────────

export function useTodayPrompt(tz: string) {
  return useQuery({
    queryKey: qk.prompt(tz),
    queryFn: ({ signal }) =>
      api.todayPrompt({ query: { tz }, signal }) as Promise<{ prompt: DailyPrompt | null }>,
    select: (d) => d.prompt,
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

export function useDismissPrompt(tz: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.dismissPrompt({ params: { id } }) as Promise<DailyPrompt>,
    onMutate: () => {
      const prev = qc.getQueryData(qk.prompt(tz));
      qc.setQueryData(qk.prompt(tz), { prompt: null });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.prompt(tz), ctx.prev);
    },
  });
}
