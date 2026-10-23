/**
 * The world, synced with the profile.
 *
 *   useWorld()  { world, manifest, setWorld }
 *     setWorld(id) switches this device at once (an attribute swap, so nothing flashes), then,
 *     when someone is signed in, PATCHes /me optimistically: the cached profile updates first
 *     and rolls back (with a toast) if the server refuses.
 *   useProfileAppearanceSync()  inside signed-in areas: on sign-in (and whenever the profile
 *     changes elsewhere) the profile's world wins and is mirrored to this device; its sound and
 *     haptics preferences switch the feedback system on or off.
 *
 * Public pages never call these: they use the device world from lib/theme.ts.
 */
import type { Profile } from '@solace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { toast } from '@/components/ui/toast';
import { setFeedbackPrefs } from '@/lib/feedback';
import { ME_QUERY_KEY, useProfile, useSession } from '@/lib/session';
import { readWorld, setDeviceWorld, useDeviceWorld } from '@/lib/theme';
import { activateWorld, worldOf, type WorldId, type WorldManifest } from '@/worlds';

let requestSeq = 0;
/** True while a world change is on its way to the server: the profile mirror must not undo it. */
let pending = 0;

export function useWorld(): { world: WorldId; manifest: WorldManifest; setWorld: (id: WorldId) => void } {
  const world = useDeviceWorld();
  const { status } = useSession();
  const queryClient = useQueryClient();

  const setWorld = useCallback(
    (next: WorldId) => {
      const previous = readWorld();
      if (next === previous) return;
      activateWorld(next);
      setDeviceWorld(next);
      const profile = queryClient.getQueryData<Profile>(ME_QUERY_KEY);
      if (status !== 'signed-in' || !profile) return;

      const seq = ++requestSeq;
      pending++;
      void queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      queryClient.setQueryData<Profile>(ME_QUERY_KEY, (p) => (p ? { ...p, world: next } : p));
      void import('@/lib/api')
        .then(({ api }) => api.updateMe({ body: { world: next } }))
        .then((saved) => {
          // A later choice is already on its way: let that one settle the cache.
          if (seq === requestSeq) queryClient.setQueryData(ME_QUERY_KEY, saved);
        })
        .catch(async (err: unknown) => {
          if (seq !== requestSeq) return;
          setDeviceWorld(previous);
          queryClient.setQueryData<Profile>(ME_QUERY_KEY, (p) => (p ? { ...p, world: previous } : p));
          const { errorMessage } = await import('@/lib/errors');
          toast(`Couldn’t save your world. ${errorMessage(err)}`, { tone: 'danger', id: 'world' });
        })
        .finally(() => {
          pending--;
        });
    },
    [queryClient, status],
  );

  return { world, manifest: worldOf(world), setWorld };
}

/** Mirrors the profile's appearance onto this device. Mount once inside signed-in areas. */
export function useProfileAppearanceSync(): void {
  const { profile } = useProfile();
  const remote = profile?.world;
  const sound = profile?.soundEnabled ?? false;
  const haptics = profile?.hapticsEnabled ?? false;

  // Before paint, so the app never shows a frame in the old world after sign-in.
  useLayoutEffect(() => {
    if (!remote || pending > 0) return;
    const next = worldOf(remote).id;
    if (next !== readWorld()) {
      activateWorld(next);
      setDeviceWorld(next);
    }
  }, [remote]);

  useEffect(() => {
    setFeedbackPrefs({ sound, haptics });
    return () => setFeedbackPrefs({ sound: false, haptics: false });
  }, [sound, haptics]);
}
