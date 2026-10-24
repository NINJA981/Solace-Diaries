import { Router } from 'express';
import { routes, statsQuery } from '@solace/shared';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { getResurface } from '../services/resurface';
import { resolveTimezone } from '../services/stats';

export const resurfaceRouter: Router = Router();

resurfaceRouter.get(routes.resurface.path, async (req, res) => {
  const { userId } = authOf(req);
  const tz = await resolveTimezone(userId, parseQuery(req, statsQuery).tz);
  res.json(await getResurface(userId, tz));
});
