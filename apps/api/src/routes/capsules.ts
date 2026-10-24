import { Router } from 'express';
import { createCapsuleInput, routes, uuid } from '@solace/shared';
import { authOf } from '../http/types';
import { parseBody, uuidParam } from '../middleware/validate';
import { createCapsule, deleteCapsule, listCapsules, openCapsule } from '../services/capsules';

export const capsulesRouter: Router = Router();

capsulesRouter.get(routes.listCapsules.path, async (req, res) => {
  res.json({ items: await listCapsules(authOf(req).userId) });
});

capsulesRouter.post(routes.createCapsule.path, async (req, res) => {
  res.status(201).json(await createCapsule(authOf(req).userId, parseBody(req, createCapsuleInput)));
});

capsulesRouter.post(routes.openCapsule.path, async (req, res) => {
  res.json(await openCapsule(authOf(req).userId, uuidParam(req)));
});

// Idempotent: 204 for a missing, malformed or someone else's id, so nothing leaks.
capsulesRouter.delete(routes.deleteCapsule.path, async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (id.success) await deleteCapsule(authOf(req).userId, id.data);
  res.status(204).end();
});
