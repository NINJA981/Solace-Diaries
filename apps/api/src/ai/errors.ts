import type { ErrorRequestHandler } from 'express';
import { ERROR_CODES } from '@solace/shared';
import { HttpError, aiUnavailable } from '../http/errors';

/** The AI service can't be reached or refused us (no key, outage, rate limit after retries, timeout). */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, when there was one. */
    public readonly status?: number,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, options);
    this.name = 'AiUnavailableError';
    this.retryAfterMs = options?.retryAfterMs;
  }

  /** How long the provider asked us to wait (from a 429's RetryInfo), when it said. */
  readonly retryAfterMs?: number;
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

/** Map gateway errors to the HTTP errors the API exposes; anything else passes through untouched. */
export function toHttpError(err: unknown): unknown {
  if (err instanceof AiUnavailableError) return aiUnavailable();
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
export const mapAiErrors: ErrorRequestHandler = (err, _req, _res, next) => next(toHttpError(err));
