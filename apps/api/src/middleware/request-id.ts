import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Accept a caller-supplied id only if it is short and boring; otherwise mint one. */
const SANE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && SANE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
