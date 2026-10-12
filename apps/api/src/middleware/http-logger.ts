import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../logger';

/**
 * Access log. Logs method, path (query string dropped: search terms are journal content),
 * status, latency and user id — never headers or bodies.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).id ?? randomUUID(),
  autoLogging: { ignore: (req) => req.url === '/api/healthz' },
  customLogLevel: (_req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  customProps: (req) => ({ userId: (req as Request).auth?.userId }),
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      path: req.url.split('?')[0],
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
