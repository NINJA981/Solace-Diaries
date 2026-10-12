import { Router } from 'express';
import multer from 'multer';
import { LIMITS, routes } from '@solace/shared';
import { badRequest } from '../http/errors';
import { authOf } from '../http/types';
import { uuidParam } from '../middleware/validate';
import { addAttachment, assertCanAttach, deleteAttachment } from '../services/entries';
import { processImage } from '../storage/image';

export const attachmentsRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: LIMITS.attachmentBytes, fields: 5 },
});

attachmentsRouter.post(
  routes.addAttachment.path,
  // Check ownership and the photo limit before buffering up to 8 MB.
  async (req, _res, next) => {
    await assertCanAttach(authOf(req).userId, uuidParam(req));
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw badRequest('Attach a photo in the "file" field.', { file: 'Required' });
    const image = await processImage(req.file.buffer);
    res.status(201).json(await addAttachment(authOf(req).userId, uuidParam(req), image));
  },
);

attachmentsRouter.delete(routes.deleteAttachment.path, async (req, res) => {
  await deleteAttachment(authOf(req).userId, uuidParam(req), uuidParam(req, 'attachmentId'));
  res.status(204).end();
});
