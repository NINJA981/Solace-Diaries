/**
 * TanStack Query hooks for the v3 time-and-memory features: capsules, resurfacing, the
 * companion and the weekly ritual. Keys are stable tuples so mutations invalidate exactly
 * what they change.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Capsule,
  CreateCapsuleInput,
  WeeklyRitualInput,
} from '@solace/shared';
import { api } from '@/lib/api';
import { qk } from './queries';

export const qk3 = {
  capsules: ['capsules'] as const,
  resurface: (tz: string, day: string) => ['resurface', tz, day] as const,
  companion: (tz: string) => ['companion', tz] as const,
};

export type CompanionData = Awaited<ReturnType<typeof api.companion>>;

export function useCapsules() {
  return useQuery({
    queryKey: qk3.capsules,
    queryFn: ({ signal }) => api.listCapsules({ signal }),
    select: (d) => d.items,
  });
}

export function useCreateCapsule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCapsuleInput) => api.createCapsule({ body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk3.capsules }),
  });
}

export function useOpenCapsule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.openCapsule({ params: { id } }),
    onSuccess: (opened: Capsule) => {
      qc.setQueryData<{ items: Capsule[] }>(qk3.capsules, (old) =>
        old ? { items: old.items.map((c) => (c.id === opened.id ? opened : c)) } : old,
      );
    },
  });
}

export function useDeleteCapsule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCapsule({ params: { id } }),
    onSuccess: (_r, id) => {
      qc.setQueryData<{ items: Capsule[] }>(qk3.capsules, (old) =>
        old ? { items: old.items.filter((c) => c.id !== id) } : old,
      );
    },
  });
}

/** "On this day" and echoes. `day` keys the cache so a new local day refetches. */
export function useResurface(tz: string, day: string, enabled = true) {
  return useQuery({
    queryKey: qk3.resurface(tz, day),
    queryFn: ({ signal }) => api.resurface({ query: { tz }, signal }),
    select: (d) => d.items,
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useCompanionState(tz: string, enabled = true) {
  return useQuery({
    queryKey: qk3.companion(tz),
    queryFn: ({ signal }) => api.companion({ query: { tz }, signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useWeeklyRitual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WeeklyRitualInput) => api.weeklyRitual({ body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.entriesAll });
      void qc.invalidateQueries({ queryKey: qk.statsAll });
      void qc.invalidateQueries({ queryKey: ['intentions'] });
    },
  });
}
