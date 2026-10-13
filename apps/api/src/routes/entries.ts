import { Router, type Request } from 'express';
import {
  createEntryInput,
  listEntriesQuery,
  routes,
  updateEntryInput,
  type Entry,
} from '@solace/shared';
import { badRequest, HttpError } from '../http/errors';
import { authOf } from '../http/types';
import { parseBody, parseQuery, uuidParam } from '../middleware/validate';
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  retryEnrichment,
  updateEntry,
} from '../services/entries';

export const entriesRouter: Router = Router();

/** `If-Match: 3`, `"3"` or `W/"3"` → 3. Missing → 428 so clients can't blindly overwrite. */
function expectedVersion(req: Request): number {
  const raw = req.get('if-match');
  if (!raw) {
    throw new HttpError(
      428,
      'Send the entry version in the If-Match header.',
      'precondition_required',
    );
  }
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim());
  if (!match)
    throw badRequest('If-Match must be the entry version number.', {
      'if-match': 'Expected a version',
    });
  return Number(match[1]);
}

/** After a write, the version doubles as the ETag so `If-Match` can echo it back verbatim. */
const versionTag = (entry: Entry) => `"${entry.version}"`;

entriesRouter.get(routes.listEntries.path, async (req, res) => {
  res.json(await listEntries(authOf(req).userId, parseQuery(req, listEntriesQuery)));
});

entriesRouter.post(routes.createEntry.path, async (req, res) => {
  const { entry, created } = await createEntry(
    authOf(req).userId,
    parseBody(req, createEntryInput),
  );
  // 201 + `X-Entry-Created: true` for a new row. A repeated client id answers 200 + `false`
  // with the row as stored, which may differ from this request's body (offline retry).
  res
    .status(created ? 201 : 200)
    .setHeader('ETag', versionTag(entry))
    .setHeader('X-Entry-Created', String(created))
    .json(entry);
});

entriesRouter.get(routes.getEntry.path, async (req, res) => {
  // No version ETag here: enrichment changes don't bump the version, so a 304 would go stale.
  res.json(await getEntry(authOf(req).userId, uuidParam(req)));
});

entriesRouter.patch(routes.updateEntry.path, async (req, res) => {
  const id = uuidParam(req);
  const version = expectedVersion(req);
  const entry = await updateEntry(
    authOf(req).userId,
    id,
    version,
    parseBody(req, updateEntryInput),
  );
  res.setHeader('ETag', versionTag(entry)).json(entry);
});

// Idempotent: 204 whether the entry was deleted now, was already gone, or never was ours,
// so a client can safely retry a delete and nothing leaks about other users' ids.
entriesRouter.delete(routes.deleteEntry.path, async (req, res) => {
  await deleteEntry(authOf(req).userId, uuidParam(req));
  res.status(204).end();
});

entriesRouter.post(routes.retryEnrichment.path, async (req, res) => {
  res.json(await retryEnrichment(authOf(req).userId, uuidParam(req)));
});
