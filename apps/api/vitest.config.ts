import { defineConfig } from 'vitest/config';

/**
 * API tests run against a real Postgres + pgvector (docker compose `db`, port 55432).
 * Each test file uses its own schema-isolated data via unique user ids; see test/helpers.
 */
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://solace:solace@localhost:55432/solace',
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      WEB_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      RUN_WORKER: 'false',
      GEMINI_API_KEY: '',
      // The test embedder scores unrelated text near 0, unlike real Gemini embeddings.
      SEARCH_MIN_SIMILARITY: '0.35',
      SEARCH_RELATIVE_BAND: '1',
      MEMORY_DEDUPE_SIMILARITY: '0.9',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
