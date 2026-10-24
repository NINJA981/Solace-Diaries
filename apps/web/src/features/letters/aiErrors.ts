import { ApiRequestError, errorMessage } from '@/lib/api';

export type AiErrorCopy = {
  message: string;
  /** Offer "add your own Gemini key in Settings". */
  suggestKey: boolean;
};

/**
 * Plain copy for AI failures. On the free tier the provider's quota is shared by everyone, so
 * neither quota nor rate-limit errors imply the person used up anything of their own.
 */
export function aiErrorCopy(err: unknown, what = 'that'): AiErrorCopy {
  if (err instanceof ApiRequestError) {
    if (err.code === 'ai_quota_exceeded')
      return {
        message: `Solace’s free AI allowance is used up for now. It’s shared by everyone using it, so this isn’t about you. You can try again later, or add your own Gemini key in Settings to write ${what} any time.`,
        suggestKey: true,
      };
    if (err.code === 'rate_limited' || err.status === 429)
      return {
        message: `The AI service is busy right now, and its free allowance is shared. Try again later, or add your own Gemini key in Settings.`,
        suggestKey: true,
      };
    if (err.code === 'ai_unavailable' || err.status === 503)
      return { message: `Solace can’t reach its AI service right now, so ${what} can’t be written. Try again in a few minutes.`, suggestKey: false };
  }
  return { message: errorMessage(err), suggestKey: false };
}
