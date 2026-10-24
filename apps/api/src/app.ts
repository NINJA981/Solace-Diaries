import compression from 'compression';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth/require-auth';
import { ageGate } from './middleware/age-gate';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { httpLogger } from './middleware/http-logger';
import { createRateLimiters, type RateLimitConfig } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { attachmentsRouter } from './routes/attachments';
import { entriesRouter } from './routes/entries';
import { healthRouter } from './routes/health';
import { insightsRouter } from './routes/insights';
import { meRouter } from './routes/me';
import { memoriesRouter } from './routes/memories';
import { promptsRouter } from './routes/prompts';
import { searchRouter } from './routes/search';
import { teenMeRouter, createConsentRouter } from './routes/teen';
import { threadsRouter } from './routes/threads';
import { v3Router } from './routes/v3';

export type AppOptions = {
  rateLimits?: Partial<RateLimitConfig>;
  /** Public consent-link requests per IP per 10 minutes (default 40). */
  consentIpLimit?: number;
};

/** Server-sent events must reach the client unbuffered. */
const compressUnlessStream: compression.CompressionFilter = (req, res) =>
  !String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream') &&
  compression.filter(req, res);

/** Journal data is private: never let a browser or proxy cache an API response. */
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'x-gemini-key'],
      // Content-Disposition carries the export filename; X-Entry-Created tells a create
      // retry whether its body was stored or an existing row came back.
      exposedHeaders: ['X-Request-Id', 'ETag', 'Content-Disposition', 'X-Entry-Created'],
      maxAge: 600,
    }),
  );
  app.use(compression({ filter: compressUnlessStream }));
  app.use(express.json({ limit: '256kb' }));

  const limit = createRateLimiters(opts.rateLimits);
  const api = express.Router();
  api.use(noStore);
  api.use(healthRouter);

  // The parent's consent page is public (the token is the credential).
  api.use(createConsentRouter(opts.consentIpLimit));

  // Everything below requires a signed-in user who has answered the age gate (and, for
  // teens, has a parent's approval).
  api.use(requireAuth, ageGate, limit.general, limit.writes);
  api.get('/search', (req, res, next) =>
    req.query.mode === 'keyword' ? next() : limit.ai(req, res, next),
  );
  api.post('/threads/:id/messages', limit.ai);
  api.post('/insights/weekly/refresh', limit.ai);
  api.post('/letters', limit.ai);
  api.post('/chapters/refresh', limit.ai);
  api.post('/entries/:id/attachments', limit.uploads);

  // Routers declare full paths from the shared route table (e.g. '/entries/:id').
  api.use(meRouter, teenMeRouter, entriesRouter, attachmentsRouter);
  api.use(searchRouter, threadsRouter, insightsRouter, memoriesRouter, promptsRouter);
  api.use(v3Router);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
