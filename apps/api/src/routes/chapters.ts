import { Router } from 'express';
import { authOf } from '../http/types';
import { listChapters, refreshChapters } from '../services/chapters';

export const chaptersRouter: Router = Router();

chaptersRouter.get('/chapters', async (req, res) => {
  res.json(await listChapters(authOf(req).userId));
});

chaptersRouter.post('/chapters/refresh', async (req, res) => {
  res.json(await refreshChapters(authOf(req).userId));
});
