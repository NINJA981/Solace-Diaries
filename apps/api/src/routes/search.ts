import { Router } from 'express';
import { searchQuery } from '@solace/shared';
import { mapAiErrors } from '../ai/errors';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { searchEntries } from '../services/search';

export const searchRouter: Router = Router();

searchRouter.get('/search', async (req, res) => {
  const { userId } = authOf(req);
  res.json(await searchEntries(userId, parseQuery(req, searchQuery), { apiKey: req.geminiKey }));
});

searchRouter.use(mapAiErrors);
