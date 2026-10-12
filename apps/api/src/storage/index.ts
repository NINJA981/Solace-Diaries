/** Private object storage (Supabase bucket in prod/dev; in-memory in tests). */
import { config, isTest } from '../config';
import { createMemoryStore } from './memory-store';
import { createSupabaseStore } from './supabase-store';

const store = isTest ? createMemoryStore() : createSupabaseStore(config.STORAGE_BUCKET);

export async function putObject(path: string, bytes: Buffer, mime: string): Promise<void> {
  await store.put(path, bytes, mime);
}

export async function getObject(path: string): Promise<Buffer> {
  return store.get(path);
}

export async function deleteObjects(paths: string[]): Promise<void> {
  if (paths.length) await store.remove(paths);
}

/** Short-lived signed read URLs, in the same order as `paths`. */
export async function signUrls(paths: string[], expiresInSec = 3600): Promise<string[]> {
  return paths.length ? store.sign(paths, expiresInSec) : [];
}

export async function listObjects(prefix: string): Promise<string[]> {
  return store.list(prefix);
}

/** Delete everything under a folder, e.g. `${userId}/` on account deletion. */
export async function deletePrefix(prefix: string): Promise<void> {
  await deleteObjects(await store.list(prefix));
}
