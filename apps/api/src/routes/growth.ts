import { Router } from 'express';
import { authOf } from '../http/types';
import { getGrowthNotes } from '../services/growth';

export const growthRouter: Router = Router();

growthRouter.get('/growth', async (req, res) => {
  res.json({ items: await getGrowthNotes(authOf(req).userId) });
});
