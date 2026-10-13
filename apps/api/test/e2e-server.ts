/**
 * Local end-to-end runs only: the real API, worker and database, with Gemini replaced by
 * the deterministic test stand-in (no network, no key). Never used in production.
 */
import { installFakeAi } from './ai/fake-ai';

if (process.env.NODE_ENV === 'production') throw new Error('e2e-server must not run in production');
installFakeAi();
await import('../src/server');
