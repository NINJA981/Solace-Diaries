/**
 * Verifies Supabase Auth access tokens. Projects on asymmetric signing keys are verified
 * against the project JWKS; the legacy HS256 shared secret is used only when configured
 * (local Supabase CLI, tests).
 */
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type FetchImplementation,
  type JWTPayload,
} from 'jose';
import { ERROR_CODES, uuid } from '@solace/shared';
import { config } from '../config';
import { HttpError, unauthorized } from '../http/errors';
import type { AuthContext } from '../http/types';
import { logger } from '../logger';

const AUDIENCE = 'authenticated';
/** Supabase Auth issues tokens with `iss` = the project's auth endpoint. */
export const ISSUER = `${config.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
const ASYMMETRIC_ALGS = ['RS256', 'ES256', 'EdDSA'];

/**
 * jose errors that mean "this token is not acceptable" → 401. Everything else, notably
 * every way fetching the JWKS can fail (non-200 → plain JOSEError, JWKSInvalid, JWKSTimeout,
 * network TypeErrors), is our outage, not a bad token → 503, so a JWKS blip doesn't sign
 * every user out.
 */
const BAD_TOKEN_CODES = new Set<string>([
  errors.JWTExpired.code,
  errors.JWTClaimValidationFailed.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
]);

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksFetch: FetchImplementation | undefined;
const getJwks = () =>
  (jwks ??= createRemoteJWKSet(
    new URL(`${ISSUER}/.well-known/jwks.json`),
    jwksFetch ? { [customFetch]: jwksFetch } : undefined,
  ));

/** Test seam: route JWKS fetches through `fetchImpl` (or back to fetch) and drop the cache. */
export function configureJwks(fetchImpl?: FetchImplementation): void {
  jwksFetch = fetchImpl;
  jwks = undefined;
}

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
  const claims = { audience: AUDIENCE, issuer: ISSUER };
  if (alg === 'HS256' && hsSecret) {
    return (await jwtVerify(token, hsSecret, { ...claims, algorithms: ['HS256'] })).payload;
  }
  return (await jwtVerify(token, getJwks(), { ...claims, algorithms: ASYMMETRIC_ALGS })).payload;
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  let payload: JWTPayload;
  try {
    payload = await verify(token);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof errors.JWTExpired)
      throw unauthorized('Your session expired. Sign in again.');
    if (err instanceof errors.JOSEError && BAD_TOKEN_CODES.has(err.code)) throw unauthorized();
    logger.error({ err }, 'could not verify token: JWKS unavailable');
    throw new HttpError(
      503,
      'Sign-in is temporarily unavailable. Try again shortly.',
      ERROR_CODES.internal,
    );
  }
  // jwtVerify requires `exp` only if present; Supabase always sets it, so insist on it.
  if (typeof payload.exp !== 'number') throw unauthorized();
  if (payload.role !== 'authenticated') throw unauthorized();
  const sub = uuid.safeParse(payload.sub);
  if (!sub.success) throw unauthorized();
  return { userId: sub.data, email: typeof payload.email === 'string' ? payload.email : '' };
}
