/** A private object store. Paths are `${userId}/${entryId}/${attachmentId}.webp`. */
export interface ObjectStore {
  put(path: string, bytes: Buffer, mime: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  remove(paths: string[]): Promise<void>;
  /** Signed read URLs, same order as `paths`. */
  sign(paths: string[], expiresInSec: number): Promise<string[]>;
  /** Every object path under `prefix` (recursive). */
  list(prefix: string): Promise<string[]>;
}
