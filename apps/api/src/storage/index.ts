// Owned by the platform layer. STUB — replaced in Phase 1 (agent A).
/** Private object storage (Supabase bucket in prod/dev; in-memory in tests). */
export async function putObject(_path: string, _bytes: Buffer, _mime: string): Promise<void> {
  throw new Error('not implemented');
}
export async function getObject(_path: string): Promise<Buffer> {
  throw new Error('not implemented');
}
export async function deleteObjects(_paths: string[]): Promise<void> {
  throw new Error('not implemented');
}
/** Short-lived signed read URLs, in the same order as `paths`. */
export async function signUrls(_paths: string[], _expiresInSec = 3600): Promise<string[]> {
  throw new Error('not implemented');
}
