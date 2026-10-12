import { defineConfig } from 'vitest/config';

/**
 * API tests run against a real Postgres + pgvector (docker compose `db`, port 54330).
 * Each test file uses its own schema-isolated data via unique user ids; see test/helpers.
 */
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://solace:solace@localhost:54330/solace',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      WEB_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      RUN_WORKER: 'false',
      GEMINI_API_KEY: '',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
