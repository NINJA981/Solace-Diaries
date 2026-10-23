import { Router, type Request } from 'express';
import { statsQuery } from '@solace/shared';
import { mapAiErrors } from '../ai/errors';
import { interactiveAi } from '../http/ai-options';
import { authOf } from '../http/types';
import { parseQuery } from '../middleware/validate';
import { getWeeklyLetter, refreshWeeklyLetter } from '../services/insights';
import { getStats, resolveTimezone } from '../services/stats';

export const insightsRouter: Router = Router();

const timezoneOf = (req: Request) =>
  resolveTimezone(authOf(req).userId, parseQuery(req, statsQuery).tz);

insightsRouter.get('/insights/stats', async (req, res) => {
  res.json(await getStats(authOf(req).userId, await timezoneOf(req)));
});

insightsRouter.get('/insights/weekly', async (req, res) => {
  res.json(
    await getWeeklyLetter(authOf(req).userId, await timezoneOf(req), interactiveAi(req, res)),
  );
});

insightsRouter.post('/insights/weekly/refresh', async (req, res) => {
  res.json(
    await refreshWeeklyLetter(authOf(req).userId, await timezoneOf(req), interactiveAi(req, res)),
  );
});

insightsRouter.use(mapAiErrors);
