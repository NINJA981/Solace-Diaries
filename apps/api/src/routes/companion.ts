import { Router } from 'express';
import { routes, statsQuery } from '@solace/shared';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { getCompanion } from '../services/companion';

export const companionRouter: Router = Router();

companionRouter.get(routes.companion.path, async (req, res) => {
  res.json(await getCompanion(authOf(req).userId, parseQuery(req, statsQuery).tz));
});
