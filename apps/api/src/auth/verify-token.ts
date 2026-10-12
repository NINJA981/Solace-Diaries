/**
 * Verifies Supabase Auth access tokens. Projects on asymmetric signing keys are verified
 * against the project JWKS; the legacy HS256 shared secret is used only when configured
 * (local Supabase CLI, tests).
 */
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { ERROR_CODES, uuid } from '@solace/shared';
import { config } from '../config';
import { HttpError, unauthorized } from '../http/errors';
import type { AuthContext } from '../http/types';
import { logger } from '../logger';

const AUDIENCE = 'authenticated';
const ASYMMETRIC_ALGS = ['RS256', 'ES256', 'EdDSA'];

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const getJwks = () =>
  (jwks ??= createRemoteJWKSet(new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)));

const hsSecret = config.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET)
  : null;

async function verify(token: string): Promise<JWTPayload> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw unauthorized();
  }
  if (alg === 'HS256' && hsSecret) {
    return (await jwtVerify(token, hsSecret, { audience: AUDIENCE, algorithms: ['HS256'] }))
      .payload;
  }
  return (await jwtVerify(token, getJwks(), { audience: AUDIENCE, algorithms: ASYMMETRIC_ALGS }))
    .payload;
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  let payload: JWTPayload;
  try {
    payload = await verify(token);
  } catch (err) {
    if (err instanceof errors.JWTExpired)
      throw unauthorized('Your session expired. Sign in again.');
    // Can't reach the key set: our outage, not a bad token — don't sign the user out.
    if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) {
      if (err instanceof HttpError) throw err;
      logger.error({ err }, 'could not verify token: JWKS unavailable');
      throw new HttpError(
        503,
        'Sign-in is temporarily unavailable. Try again shortly.',
        ERROR_CODES.internal,
      );
    }
    throw unauthorized();
  }
  // jwtVerify requires `exp` only if present; Supabase always sets it, so insist on it.
  if (typeof payload.exp !== 'number') throw unauthorized();
  if (payload.role !== 'authenticated') throw unauthorized();
  const sub = uuid.safeParse(payload.sub);
  if (!sub.success) throw unauthorized();
  return { userId: sub.data, email: typeof payload.email === 'string' ? payload.email : '' };
}
