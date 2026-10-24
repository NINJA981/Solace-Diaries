/**
 * Age and parental-consent gate, mounted once after requireAuth.
 *   - age not confirmed        → 403 age_required
 *   - teen without a consent   → 403 consent_required (pending, denied or revoked)
 * A short list of routes stays reachable so people can answer the gate, read their profile,
 * export their data and delete their account.
 */
import type { RequestHandler } from 'express';
import { TEEN_ERROR_CODES } from '@solace/shared';
import { isTest } from '../config';
import { HttpError } from '../http/errors';
import { gateState } from '../services/profiles';

const ALWAYS = new Set(['/me', '/me/age', '/me/usage', '/me/export']);
const TEEN_EXTRA = '/me/consent';

let enforced = !isTest;
/** Test seam: the older suites use fresh, un-gated users, the teen suite turns this on. */
export function setAgeGateEnforced(on: boolean): void {
  if (!isTest) throw new Error('setAgeGateEnforced is for tests only');
  enforced = on;
}

export const ageGate: RequestHandler = async (req, _res, next) => {
  if (!enforced) return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  if (ALWAYS.has(path)) return next();
  const state = req.auth ? await gateState(req.auth.userId) : undefined;
  if (!state) return next(); // no profile row: nothing to gate (requireAuth creates it)
  if (state.ageBand === null) {
    throw new HttpError(
      403,
      'Tell us your age to continue.',
      TEEN_ERROR_CODES.ageRequired,
    );
  }
  if (state.mode === 'teen' && state.consentStatus !== 'granted') {
    if (path === TEEN_EXTRA) return next();
    throw new HttpError(
      403,
      'A parent or guardian needs to approve this account first.',
      TEEN_ERROR_CODES.consentRequired,
    );
  }
  next();
};
