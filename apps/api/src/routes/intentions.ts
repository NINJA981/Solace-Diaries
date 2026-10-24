import { Router } from 'express';
import { checkinInput, createIntentionInput, routes, updateIntentionInput } from '@solace/shared';
import { authOf } from '../http/types';
import { parseBody, uuidParam } from '../middleware/validate';
import {
  checkIn,
  createIntention,
  deleteIntention,
  listIntentions,
  listSuggestions,
  undoCheckIn,
  updateIntention,
} from '../services/intentions';

export const intentionsRouter: Router = Router();

intentionsRouter.get(routes.listIntentions.path, async (req, res) => {
  res.json({ items: await listIntentions(authOf(req).userId) });
});

// Declared before any `/intentions/:id` route so "suggestions" is never read as an id.
intentionsRouter.get(routes.intentionSuggestions.path, async (req, res) => {
  res.json({ items: await listSuggestions(authOf(req).userId) });
});

intentionsRouter.post(routes.createIntention.path, async (req, res) => {
  res
    .status(201)
    .json(await createIntention(authOf(req).userId, parseBody(req, createIntentionInput)));
});

intentionsRouter.patch(routes.updateIntention.path, async (req, res) => {
  res.json(
    await updateIntention(authOf(req).userId, uuidParam(req), parseBody(req, updateIntentionInput)),
  );
});

intentionsRouter.delete(routes.deleteIntention.path, async (req, res) => {
  await deleteIntention(authOf(req).userId, uuidParam(req));
  res.status(204).end();
});

intentionsRouter.post(routes.checkIn.path, async (req, res) => {
  res.json(await checkIn(authOf(req).userId, uuidParam(req), parseBody(req, checkinInput)));
});

intentionsRouter.delete(routes.undoCheckIn.path, async (req, res) => {
  res.json(await undoCheckIn(authOf(req).userId, uuidParam(req), req.params.date ?? ''));
});
