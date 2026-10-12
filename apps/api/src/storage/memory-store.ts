import { randomBytes } from 'node:crypto';
import type { ObjectStore } from './types';

/** In-process store used by tests: same semantics as the bucket, nothing leaves memory. */
export function createMemoryStore(): ObjectStore {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  return {
    async put(path, bytes, mime) {
      objects.set(path, { bytes: Buffer.from(bytes), mime });
    },
    async get(path) {
      const obj = objects.get(path);
      if (!obj) throw new Error(`Object not found: ${path}`);
      return obj.bytes;
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
    },
    async sign(paths) {
      return paths.map(
        (p) => `http://storage.test/${encodeURI(p)}?sig=${randomBytes(6).toString('hex')}`,
      );
    },
    async list(prefix) {
      return [...objects.keys()].filter((p) => p.startsWith(prefix));
    },
  };
}
