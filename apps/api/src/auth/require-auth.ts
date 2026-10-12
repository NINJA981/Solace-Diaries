import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../http/errors';
import { ensureProfile } from '../services/profiles';
import { verifyAccessToken } from './verify-token';

const BEARER = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i;
/** Printable ASCII without spaces — API keys never contain anything else. */
const KEY_CHARS = /^[\x21-\x7e]+$/;
const KEY_MAX = 200;

function readGeminiKey(raw: string | undefined): string | undefined {
  const key = raw?.trim();
  if (!key) return undefined;
  if (key.length > KEY_MAX || !KEY_CHARS.test(key)) {
    throw badRequest('The Gemini key header is malformed.', { 'x-gemini-key': 'Malformed key' });
  }
  return key;
}

/**
 * Authenticates `Authorization: Bearer <supabase access token>`, sets `req.auth` and
 * `req.geminiKey`, and lazily creates the caller's profile row.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const match = BEARER.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw unauthorized();
  const auth = await verifyAccessToken(match[1]);
  req.auth = auth;
  req.geminiKey = readGeminiKey(req.get('x-gemini-key'));
  await ensureProfile(auth.userId, auth.email);
  next();
};
