import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

/** Single shared pool. `prepare: false` keeps us compatible with Supabase's transaction pooler. */
export const sqlClient = postgres(config.DATABASE_URL, {
  max: config.DATABASE_POOL_MAX,
  prepare: false,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema, casing: 'snake_case' });
export type Db = typeof db;
/** Either the root db or a transaction handle. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export async function pingDb(): Promise<boolean> {
  try {
    await sqlClient`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}

export { schema };
