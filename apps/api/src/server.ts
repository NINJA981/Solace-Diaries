/** Process entry point. Migrations run as a separate deploy step, not here. */
import { createApp } from './app';
import { config } from './config';
import { closeDb } from './db/client';
import { startWorker, stopWorker } from './jobs/worker';
import { logger } from './logger';

const SHUTDOWN_DEADLINE_MS = 28_000;
const STREAM_GRACE_MS = 10_000;

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, worker: config.RUN_WORKER }, 'api listening');
});
server.on('error', (err) => {
  logger.fatal({ err }, 'http server failed');
  process.exit(1);
});
// Outlive the load balancer's idle timeout so it never reuses a socket we just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

if (config.RUN_WORKER) startWorker();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.error('shutdown deadline exceeded, exiting');
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();

  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  // Give open chat streams a moment to finish before cutting them.
  setTimeout(() => server.closeAllConnections(), STREAM_GRACE_MS).unref();

  try {
    await Promise.all([httpClosed, stopWorker()]);
    await closeDb();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
