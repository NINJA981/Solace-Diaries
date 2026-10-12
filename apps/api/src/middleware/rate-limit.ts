/**
 * Rate limiters. Keyed by user id once `requireAuth` has run, else by client IP.
 * Each app instance gets its own in-memory store (one API process on Render).
 */
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { ERROR_CODES, type ApiError } from '@solace/shared';

export type RateLimitConfig = {
  /** Any authenticated API call, per minute. */
  general: number;
  /** Mutating calls (POST/PATCH/DELETE), per minute. */
  writes: number;
  /** Photo uploads, per 10 minutes. */
  uploads: number;
  /** Gemini-backed calls (hybrid search, chat, weekly refresh), per minute. */
  ai: number;
};

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  general: 300,
  writes: 60,
  uploads: 20,
  ai: 20,
};

const MINUTE = 60_000;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function keyOf(req: Request): string {
  return req.auth ? `u:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

function limiter(
  windowMs: number,
  limit: number,
  message: string,
  skip?: (req: Request) => boolean,
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyOf,
    ...(skip ? { skip } : {}),
    handler: (req, res) => {
      res
        .status(429)
        .json({
          error: message,
          code: ERROR_CODES.rateLimited,
          requestId: req.id,
        } satisfies ApiError);
    },
  });
}

export type RateLimiters = Record<keyof RateLimitConfig, RequestHandler>;

export function createRateLimiters(overrides: Partial<RateLimitConfig> = {}): RateLimiters {
  const l = { ...DEFAULT_RATE_LIMITS, ...overrides };
  return {
    general: limiter(MINUTE, l.general, 'Too many requests. Slow down for a moment.'),
    writes: limiter(MINUTE, l.writes, 'Too many changes at once. Try again in a minute.', (req) =>
      READ_METHODS.has(req.method),
    ),
    uploads: limiter(10 * MINUTE, l.uploads, 'Too many photo uploads. Try again in a few minutes.'),
    ai: limiter(MINUTE, l.ai, 'Solace needs a short breather. Try again in a minute.'),
  };
}
