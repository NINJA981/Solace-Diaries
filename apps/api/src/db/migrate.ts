/** Applies checked-in SQL migrations. Run on every deploy before the server starts. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/db (tsx) and from dist/ (bundled): migrations live in apps/api/drizzle.
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, here.endsWith('dist') ? '../drizzle' : '../../drizzle');

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: folder });
await client.end();
console.log(`Migrations applied from ${folder}`);
