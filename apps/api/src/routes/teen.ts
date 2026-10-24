/** Teen mode: the age gate, the consent request (authed) and the parent's page (public). */
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
  ageCheckInput,
  consentDecisionInput,
  consentRequestInput,
  ERROR_CODES,
  routes,
  type ApiError,
} from '@solace/shared';
import { authOf } from '../http/types';
import { parseBody } from '../middleware/validate';
import { confirmAge, decideConsent, requestConsent, viewConsent } from '../services/teen';

/** Authed: mounted behind requireAuth and the age gate. */
export const teenMeRouter: Router = Router();

teenMeRouter.post(routes.confirmAge.path, async (req, res) => {
  res.json(await confirmAge(authOf(req).userId, parseBody(req, ageCheckInput)));
});

teenMeRouter.post(routes.requestConsent.path, async (req, res) => {
  const { parentEmail } = parseBody(req, consentRequestInput);
  res.json(await requestConsent(authOf(req).userId, parentEmail));
});

/** Public (no auth): per-IP limits so tokens cannot be guessed in bulk. */
export function createConsentRouter(perWindow = 40): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: perWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many attempts. Try again in a few minutes.',
        code: ERROR_CODES.rateLimited,
        requestId: req.id,
      } satisfies ApiError);
    },
  });
  router.get(routes.viewConsent.path, limiter, async (req, res) => {
    res.json(await viewConsent(String(req.params.token)));
  });
  router.post(routes.decideConsent.path, limiter, async (req, res) => {
    const input = parseBody(req, consentDecisionInput);
    res.json(await decideConsent(String(req.params.token), input));
  });
  return router;
}
