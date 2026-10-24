import { Router } from 'express';
import { routes, statsQuery } from '@solace/shared';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { getCorrelations } from '../services/correlations';

export const correlationsRouter: Router = Router();

correlationsRouter.get(routes.correlations.path, async (req, res) => {
  res.json(await getCorrelations(authOf(req).userId, parseQuery(req, statsQuery).tz));
});
