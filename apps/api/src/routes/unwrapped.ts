import { Router } from 'express';
import { routes, unwrappedQuery } from '@solace/shared';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { resolveTimezone } from '../services/stats';
import { getUnwrapped } from '../services/unwrapped';

export const unwrappedRouter: Router = Router();

unwrappedRouter.get(routes.unwrapped.path, async (req, res) => {
  const { userId } = authOf(req);
  const q = parseQuery(req, unwrappedQuery);
  const tz = await resolveTimezone(userId, q.tz);
  res.json(await getUnwrapped(userId, q.period, q.at, tz));
});
