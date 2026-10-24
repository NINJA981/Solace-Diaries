import { Router, type Request } from 'express';
import { replyToLetterInput, statsQuery } from '@solace/shared';
import { mapAiErrors } from '../ai/errors';
import { interactiveAi } from '../http/ai-options';
import { authOf } from '../http/types';
import { parseBody, parseQuery, uuidParam } from '../middleware/validate';
import { listLetters, replyToLetter, writeLetter } from '../services/letters';
import { resolveTimezone } from '../services/stats';

export const lettersRouter: Router = Router();

const timezoneOf = (req: Request) =>
  resolveTimezone(authOf(req).userId, parseQuery(req, statsQuery).tz);

lettersRouter.get('/letters', async (req, res) => {
  res.json(await listLetters(authOf(req).userId, await timezoneOf(req)));
});

lettersRouter.post('/letters', async (req, res) => {
  res.json(await writeLetter(authOf(req).userId, await timezoneOf(req), interactiveAi(req, res)));
});

lettersRouter.post('/letters/:id/reply', async (req, res) => {
  const { body } = parseBody(req, replyToLetterInput);
  res.json(await replyToLetter(authOf(req).userId, uuidParam(req), body, await timezoneOf(req)));
});

lettersRouter.use(mapAiErrors);
