import type { ErrorRequestHandler } from 'express';
import { ERROR_CODES } from '@solace/shared';
import { HttpError, aiUnavailable } from '../http/errors';

/** The AI service can't be reached or refused us (no key, outage, rate limit after retries, timeout). */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, when there was one. */
    public readonly status?: number,
    options?: { cause?: unknown; retryAfterMs?: number; spent?: boolean },
  ) {
    super(message, options);
    this.name = 'AiUnavailableError';
    this.retryAfterMs = options?.retryAfterMs;
    this.spent = options?.spent ?? false;
  }

  /** How long to wait before asking again (Gemini's RetryInfo, or longer for a spent quota). */
  readonly retryAfterMs?: number;
  /**
   * A 429 for a quota that is used up until it resets (a per-day quota, or a wait of many
   * minutes), as opposed to a burst limit that clears within the minute.
   */
  readonly spent: boolean;
}

/** The model answered, but with something we can't use (invalid JSON, empty, wrong dimensions). */
export class AiBadOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiBadOutputError';
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/**
 * A provider 429 asking us to wait at least this long is a spent quota (daily quotas ask for
 * hours), not a burst limit that clears within the minute. Used by the gateway when the 429
 * names no quota; a per-day quota id marks the error `spent` whatever the delay.
 */
export const SPENT_QUOTA_WAIT_MS = 10 * 60_000;

/** Gemini refused because a quota is used up (429) — as the HTTP error a person should see. */
export function providerLimitError(err: AiUnavailableError, ownKey: boolean): HttpError {
  if (err.spent) {
    return new HttpError(
      429,
      ownKey
        ? 'Your Gemini key has used up its quota for now. Try again later.'
        : "Solace's shared AI allowance is used up for now. Add your own Gemini key in Settings, or try again later.",
      ERROR_CODES.quotaExceeded,
    );
  }
  return new HttpError(
    429,
    'Solace’s AI is busy right now. Wait a moment, then try again.',
    ERROR_CODES.rateLimited,
  );
}

/** Map gateway errors to the HTTP errors the API exposes; anything else passes through untouched. */
export function toHttpError(err: unknown, opts: { ownKey?: boolean } = {}): unknown {
  if (err instanceof AiUnavailableError) {
    return err.status === 429 ? providerLimitError(err, Boolean(opts.ownKey)) : aiUnavailable();
  }
  if (err instanceof AiBadOutputError) {
    return new HttpError(
      503,
      "Solace's AI gave an answer it couldn't use. Please try again.",
      ERROR_CODES.aiUnavailable,
    );
  }
  return err;
}

/** Router-level error middleware: translate AI errors before the platform error handler sees them. */
export const mapAiErrors: ErrorRequestHandler = (err, req, _res, next) =>
  next(toHttpError(err, { ownKey: Boolean(req.geminiKey) }));
