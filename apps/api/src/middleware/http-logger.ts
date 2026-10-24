import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../logger';

/**
 * The path as it may be logged: query string dropped, and the parental-consent token (the only
 * credential of the public consent endpoints) replaced by a placeholder.
 */
export function loggablePath(url: string): string {
  return (url.split('?')[0] ?? '').replace(/(\/consent\/)[^/]*/g, '$1:token');
}

export const httpLogSerializers = {
  req: (req: { id: unknown; method: string; url: string }) => ({
    id: req.id,
    method: req.method,
    path: loggablePath(req.url),
  }),
  res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
};

/**
 * Access log. Logs method, path (query string dropped: search terms are journal content),
 * status, latency and user id — never headers or bodies. Consent tokens are redacted.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).id ?? randomUUID(),
  autoLogging: { ignore: (req) => req.url === '/api/healthz' },
  customLogLevel: (_req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  customProps: (req) => ({ userId: (req as Request).auth?.userId }),
  serializers: httpLogSerializers,
});
