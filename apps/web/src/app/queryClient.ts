import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/errors';

/** Retry transient failures (network, cold start, 5xx) but never client errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** The API says the age gate or a parent's approval is missing (e.g. approval was just withdrawn). */
export function isGateError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 403 && (error.code === 'age_required' || error.code === 'consent_required');
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // A gate error means the profile is out of date: reload it and the route guard moves the person.
    queryCache: new QueryCache({
      onError: (error) => {
        if (isGateError(error)) void client.invalidateQueries({ queryKey: ['me'] });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
