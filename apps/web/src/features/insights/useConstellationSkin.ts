import { useEffect, useReducer } from 'react';
import { useDeviceWorld } from '@/lib/theme';
import { starsSkin } from '@/worlds/lamplight/constellationSkin';
import { worldOf, type WorldId } from '@/worlds';
import type { ConstellationSkin } from './skin';

const loaded = new Map<WorldId, ConstellationSkin>([['lamplight', starsSkin]]);

/** The current world's constellation skin; Lamplight's stars stand in while another one loads. */
export function useConstellationSkin(): ConstellationSkin {
  const world = useDeviceWorld();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (loaded.has(world)) return;
    let alive = true;
    worldOf(world)
      .loadConstellationSkin()
      .then((skin) => {
        loaded.set(world, skin);
        if (alive) rerender();
      })
      .catch(() => {
        /* keep the stars */
      });
    return () => {
      alive = false;
    };
  }, [world]);
  return loaded.get(world) ?? starsSkin;
}
