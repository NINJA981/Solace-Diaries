import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import {
  deleteAccountInput,
  exportQuery,
  localDate,
  routes,
  updateProfileInput,
} from '@solace/shared';
import { authOf } from '../http/types';
import { parseBody, parseQuery } from '../middleware/validate';
import { deleteAccount, exportJson, exportMarkdown } from '../services/account';
import { getProfile, toProfile, updateProfile } from '../services/profiles';
import { profileForClient } from '../services/teen';
import { getUsage } from '../services/quota';

export const meRouter: Router = Router();

meRouter.get(routes.getMe.path, async (req, res) => {
  res.json(await profileForClient(authOf(req).userId));
});

/** Today's AI budgets for the Settings meter (and the tier, which decides the privacy copy). */
meRouter.get(routes.getUsage.path, async (req, res) => {
  res.json(await getUsage(authOf(req).userId, { ownKey: Boolean(req.geminiKey) }));
});

meRouter.patch(routes.updateMe.path, async (req, res) => {
  res.json(toProfile(await updateProfile(authOf(req).userId, parseBody(req, updateProfileInput))));
});

meRouter.get(routes.exportMe.path, async (req, res) => {
  const { userId } = authOf(req);
  const { format } = parseQuery(req, exportQuery);
  // Fails fast (as a normal JSON error) before any bytes are streamed.
  const profile = await getProfile(userId);
  const day = localDate(new Date(), profile.timezone);
  const [ext, type, chunks] =
    format === 'markdown'
      ? (['md', 'text/markdown; charset=utf-8', exportMarkdown(userId)] as const)
      : (['json', 'application/json; charset=utf-8', exportJson(userId)] as const);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="solace-export-${day}.${ext}"`);
  res.setHeader('Cache-Control', 'no-store');
  await pipeline(Readable.from(chunks), res);
});

meRouter.delete(routes.deleteMe.path, async (req, res) => {
  const { confirmEmail } = parseBody(req, deleteAccountInput);
  await deleteAccount(authOf(req), confirmEmail);
  res.status(204).end();
});
