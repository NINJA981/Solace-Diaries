import { Router } from 'express';
import { routes, weeklyRitualInput } from '@solace/shared';
import { authOf } from '../http/types';
import { parseBody } from '../middleware/validate';
import { weeklyRitual } from '../services/ritual';

export const ritualsRouter: Router = Router();

ritualsRouter.post(routes.weeklyRitual.path, async (req, res) => {
  res.json(await weeklyRitual(authOf(req).userId, parseBody(req, weeklyRitualInput)));
});
