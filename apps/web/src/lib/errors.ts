/** Error types shared by the API client and UI (kept free of heavy imports). */

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export function isApiError(error: unknown, code?: string): error is ApiRequestError {
  return error instanceof ApiRequestError && (code === undefined || error.code === code);
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/** A sentence a person can act on, for toasts and inline errors. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
