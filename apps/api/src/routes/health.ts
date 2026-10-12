import { Router } from 'express';
import type { z } from 'zod';
import { routes, type health } from '@solace/shared';
import pkg from '../../package.json' with { type: 'json' };
import { pingDb } from '../db/client';

export const healthRouter: Router = Router();

healthRouter.get(routes.health.path, async (_req, res) => {
  const db = await pingDb();
  const body: z.infer<typeof health> = { ok: db, db, version: pkg.version };
  res
    .status(db ? 200 : 503)
    .setHeader('Cache-Control', 'no-store')
    .json(body);
});
