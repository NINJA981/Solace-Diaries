import type { Request, Response } from 'express';
import type { AiOptions } from '../ai/gemini';

/** How long an interactive request may sleep on a provider rate limit before it fails fast. */
export const INTERACTIVE_INLINE_WAIT_MS = 3_000;

/**
 * AI options for a request someone is waiting on: their own key, a signal that cancels the
 * call (and any retry sleep) when they go away before the answer is sent, and a short
 * inline-wait budget so a rate limit surfaces quickly instead of holding the request.
 */
export function interactiveAi(req: Request, res: Response): AiOptions {
  const gone = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) gone.abort();
  });
  return {
    apiKey: req.geminiKey,
    signal: gone.signal,
    maxInlineWaitMs: INTERACTIVE_INLINE_WAIT_MS,
  };
}
