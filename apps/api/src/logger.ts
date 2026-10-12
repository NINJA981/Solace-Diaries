import pino from 'pino';
import { config, isProd } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  // Never log secrets or journal content.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-gemini-key"]',
      'req.headers.cookie',
      '*.body',
      '*.content',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
});
