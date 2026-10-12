import { supabaseAdmin } from '../auth/supabase-admin';
import type { ObjectStore } from './types';

const REMOVE_BATCH = 1000;
const LIST_PAGE = 1000;

/** Private Supabase Storage bucket accessed with the service-role key. */
export function createSupabaseStore(bucket: string): ObjectStore {
  const files = () => supabaseAdmin().storage.from(bucket);

  async function listDir(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await files().list(dir, { limit: LIST_PAGE, offset });
      if (error) throw error;
      for (const item of data) {
        const path = dir ? `${dir}/${item.name}` : item.name;
        // Folders are returned without an id.
        if (item.id === null) out.push(...(await listDir(path)));
        else out.push(path);
      }
      if (data.length < LIST_PAGE) return out;
    }
  }

  return {
    async put(path, bytes, mime) {
      const { error } = await files().upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw error;
    },
    async get(path) {
      const { data, error } = await files().download(path);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const { error } = await files().remove(paths.slice(i, i + REMOVE_BATCH));
        if (error) throw error;
      }
    },
    async sign(paths, expiresInSec) {
      if (paths.length === 0) return [];
      const { data, error } = await files().createSignedUrls(paths, expiresInSec);
      if (error) throw error;
      const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
      return paths.map((p) => {
        const url = byPath.get(p);
        if (!url) throw new Error(`Could not sign storage object ${p}`);
        return url;
      });
    },
    async list(prefix) {
      return listDir(prefix.replace(/\/+$/, ''));
    },
  };
}
