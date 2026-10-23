/**
 * The world registry. Anyone may pick any world; Lamplight is the default.
 *
 *   worlds[id]            the manifest (metadata, motion presets, haptics, lazy loaders, slots)
 *   WORLD_ORDER           picker order
 *   worldOf(value)        a manifest for any value (unknown → the default world)
 *   useWorldManifest()    the current world's manifest (device appearance, public pages too)
 *   activateWorld(id)     start loading what the world needs (fonts, voice) — idempotent
 *
 * Adding a world: see README notes in src/worlds/types.ts and the report in the PR: a folder
 * with tokens.css + manifest.ts, an entry in theme-colors.json and in `worlds` below, and the
 * id in the shared contract's WORLDS. contrast.test.ts and registry.test.ts then enforce it.
 */
import type { World } from '@solace/shared';
import { useDeviceWorld } from '@/lib/theme';
import { chrome } from './chrome/manifest';
import { jelly } from './jelly/manifest';
import { lamplight } from './lamplight/manifest';
import { scrapbook } from './scrapbook/manifest';
import { DEFAULT_WORLD as DEFAULT_ID } from './theme-init';
import type { WorldId, WorldManifest } from './types';

export type { WorldId, WorldManifest } from './types';

/** Every world in the shared contract has a manifest (a missing one fails the type check). */
export const worlds: Record<World, WorldManifest> = { lamplight, jelly, scrapbook, chrome };
export const WORLD_ORDER: readonly WorldId[] = ['lamplight', 'jelly', 'scrapbook', 'chrome'];
export const DEFAULT_WORLD = DEFAULT_ID as WorldId;

export function worldOf(value: unknown): WorldManifest {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(worlds, value)
    ? worlds[value as WorldId]
    : worlds[DEFAULT_WORLD];
}

export function useWorldManifest(): WorldManifest {
  return worldOf(useDeviceWorld());
}

const activated = new Set<WorldId>();
/** Starts loading a world's fonts (and anything else it needs up front). Safe to call often. */
export function activateWorld(id: WorldId): void {
  if (activated.has(id)) return;
  activated.add(id);
  void worldOf(id)
    .loadFonts()
    .catch(() => {
      activated.delete(id); // try again next time; system fonts stand in meanwhile
    });
}
