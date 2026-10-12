import { Router } from 'express';
import { statsQuery } from '@solace/shared';
import { authOf } from '../http/types';
import { parseQuery, uuidParam } from '../middleware/validate';
import { dismissPrompt, getTodayPrompt } from '../services/prompts';
import { resolveTimezone } from '../services/stats';

export const promptsRouter: Router = Router();

promptsRouter.get('/prompts/today', async (req, res) => {
  const { userId } = authOf(req);
  const tz = await resolveTimezone(userId, parseQuery(req, statsQuery).tz);
  res.json({ prompt: await getTodayPrompt(userId, tz, { apiKey: req.geminiKey }) });
});

promptsRouter.post('/prompts/:id/dismiss', async (req, res) => {
  res.json(await dismissPrompt(authOf(req).userId, uuidParam(req)));
});
