/** 404 + central error handler: every failure leaves the API as an `ApiError` body. */
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiError } from '@solace/shared';
import { HttpError } from '../http/errors';
import { logger } from '../logger';

function send(
  res: Response,
  status: number,
  body: Omit<ApiError, 'requestId'>,
  requestId?: string,
) {
  res.status(status).json({ ...body, requestId } satisfies ApiError);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, 404, { error: 'Not found', code: ERROR_CODES.notFound }, req.id);
};

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** body-parser errors carry `type` + `status`; these messages are ours, not the parser's. */
const BODY_ERRORS: Record<string, [number, string]> = {
  'entity.parse.failed': [400, 'Request body is not valid JSON.'],
  'entity.too.large': [413, 'Request body is too large.'],
  'encoding.unsupported': [415, 'Unsupported content encoding.'],
  'charset.unsupported': [415, 'Unsupported charset.'],
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // Too late for a JSON body (e.g. mid-download); let Express abort the connection.
    logger.error({ err, requestId: req.id }, 'error after headers were sent');
    return next(err);
  }

  if (err instanceof HttpError) {
    const body: Omit<ApiError, 'requestId'> = { error: err.message, code: err.code };
    if (err.fields) body.fields = err.fields;
    return send(res, err.status, body, req.id);
  }
  if (err instanceof ZodError) {
    return send(
      res,
      400,
      { error: 'Some fields are invalid.', code: ERROR_CODES.validation, fields: zodFields(err) },
      req.id,
    );
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return send(
      res,
      tooLarge ? 413 : 400,
      {
        error: tooLarge
          ? 'That photo is too large (max 8 MB).'
          : 'Upload one photo in the "file" field.',
        code: ERROR_CODES.validation,
      },
      req.id,
    );
  }
  const bodyError = typeof err?.type === 'string' ? BODY_ERRORS[err.type] : undefined;
  if (bodyError) {
    return send(res, bodyError[0], { error: bodyError[1], code: ERROR_CODES.validation }, req.id);
  }

  logger.error({ err, requestId: req.id }, 'unhandled error');
  send(
    res,
    500,
    { error: 'Something went wrong on our side.', code: ERROR_CODES.internal },
    req.id,
  );
};
