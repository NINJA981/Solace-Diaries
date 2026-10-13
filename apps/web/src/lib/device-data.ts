/**
 * What this browser keeps for a signed-in person, and how it is cleaned up when they leave,
 * so the next account on a shared browser starts clean:
 *  - the BYOK Gemini key (localStorage),
 *  - journal drafts, the offline queue and the Today pointer (IndexedDB, per user).
 *
 * The editor registry is imported lazily so public pages don't pay for it.
 */
import { setGeminiKey } from './byok';

const registry = () => import('@/features/journal-core/editor/registry');

/** Best effort, bounded: push unsaved words to the server while the session is still valid. */
export async function syncBeforeSignOut(userId: string): Promise<void> {
  try {
    await (await registry()).flushUserDrafts(userId);
  } catch {
    /* offline or storage unavailable: nothing more we can do */
  }
}

/**
 * Forget the BYOK key and stop `userId`'s editors. Their drafts and queued writes are erased
 * too, except with `keepUnsyncedDrafts` (a normal sign-out): words that never reached the
 * server stay on this device, keyed to that user, until they sign in again.
 */
export async function clearDeviceData(
  userId: string | null,
  opts: { keepUnsyncedDrafts?: boolean } = {},
): Promise<void> {
  setGeminiKey(null);
  if (!userId) return;
  try {
    await (await registry()).forgetUserOnDevice(userId, opts);
  } catch {
    /* storage unavailable */
  }
}
