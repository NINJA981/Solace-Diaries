/**
 * Zod parsing helpers for request input. They return the parsed value instead of mutating
 * the request: in Express 5 `req.query` is a getter, so assignments to it don't stick.
 * A ZodError thrown here becomes a 400 `validation_failed` in the error handler.
 */
import type { Request } from 'express';
import type { z } from 'zod';
import { uuid } from '@solace/shared';
import { notFound } from '../http/errors';

export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return schema.parse(req.query);
}

/** A uuid path param. Malformed ids are reported as 404, the same as unknown ones. */
export function uuidParam(req: Request, name = 'id'): string {
  const parsed = uuid.safeParse(req.params[name]);
  if (!parsed.success) throw notFound();
  return parsed.data;
}
