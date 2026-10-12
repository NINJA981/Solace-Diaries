import { Router } from 'express';
import { listMemoriesQuery, updateMemoryInput } from '@solace/shared';
import { mapAiErrors } from '../ai/errors';
import { notFound } from '../http/errors';
import { authOf } from '../http/types';
import { parseBody, parseQuery, uuidParam } from '../middleware/validate';
import { getGraph } from '../services/graph';
import { deleteMemory, listMemories, updateMemory } from '../services/memories';

export const memoriesRouter: Router = Router();

memoriesRouter.get('/memories', async (req, res) => {
  const { userId } = authOf(req);
  res.json({ items: await listMemories(userId, parseQuery(req, listMemoriesQuery)) });
});

memoriesRouter.get('/memories/graph', async (req, res) => {
  res.json(await getGraph(authOf(req).userId));
});

memoriesRouter.patch('/memories/:id', async (req, res) => {
  const { userId } = authOf(req);
  const id = uuidParam(req);
  const input = parseBody(req, updateMemoryInput);
  res.json(await updateMemory(userId, id, input, { apiKey: req.geminiKey }));
});

memoriesRouter.delete('/memories/:id', async (req, res) => {
  if (!(await deleteMemory(authOf(req).userId, uuidParam(req))))
    throw notFound('Memory not found.');
  res.status(204).end();
});

memoriesRouter.use(mapAiErrors);
