import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PAUSE_MS,
  msUntilQuotaReset,
  pauseModel,
  pauseOf,
  pausedFor,
  resetLedger,
} from '../../src/ai/ledger';

beforeEach(resetLedger);

describe('model pauses', () => {
  it('end: a pause is over once its time has passed', () => {
    pauseModel('k', 'm', 1_000, 0);
    expect(pausedFor('k', 'm', 999)).toBe(1);
    expect(pausedFor('k', 'm', 1_000)).toBe(0);
    expect(pausedFor('k', 'm', 5_000)).toBe(0);
    expect(pausedFor('k2', 'm', 0)).toBe(0); // other keys and models are unaffected
    expect(pausedFor('k', 'other', 0)).toBe(0);
  });

  it('never shortens a longer pause, and extends a shorter one', () => {
    pauseModel('k', 'm', 1_000, 0);
    pauseModel('k', 'm', 10, 500); // ends at 510, earlier than 1000
    expect(pausedFor('k', 'm', 999)).toBe(1);
    pauseModel('k', 'm', 2_000, 600); // ends at 2600
    expect(pausedFor('k', 'm', 1_000)).toBe(1_600);
  });

  it('caps a malformed, endless delay and reports whether a quota is spent', () => {
    pauseModel('k', 'm', 10 * MAX_PAUSE_MS, 0, { spent: true });
    expect(pausedFor('k', 'm', 0)).toBe(MAX_PAUSE_MS);
    expect(pauseOf('k', 'm', 1)).toMatchObject({ spent: true });
    expect(pauseOf('k', 'nope', 1)).toBeNull();
  });

  it('computes the wait until the Pacific-midnight daily reset', () => {
    const wait = msUntilQuotaReset(Date.UTC(2026, 0, 15, 12, 0, 0)); // 04:00 in Los Angeles
    expect(wait).toBe(20 * 3_600_000);
    const now = Date.now();
    expect(msUntilQuotaReset(now)).toBeGreaterThan(0);
    expect(msUntilQuotaReset(now)).toBeLessThanOrEqual(24 * 3_600_000);
  });
});

describe('pause eviction when the ledger is full', () => {
  const fill = (n: number, ms: number, now: number) => {
    for (let i = 0; i < n; i++) pauseModel(`own-${i}`, 'm', ms, now);
  };

  it('sweeps expired pauses instead of evicting the live server-key pause', () => {
    pauseModel('server', 'm', 4 * 3_600_000, 0, { spent: true, pinned: true });
    fill(255, 40_000, 0); // the map is now full; all of these expire after 40s
    pauseModel('own-new', 'm', 40_000, 100_000); // forces room to be made
    expect(pausedFor('server', 'm', 100_000)).toBeGreaterThan(3 * 3_600_000);
    expect(pausedFor('own-0', 'm', 100_000)).toBe(0);
    expect(pausedFor('own-new', 'm', 100_000)).toBe(40_000);
  });

  it('when everything is live, evicts the pause that ends soonest, never a pinned one', () => {
    pauseModel('server', 'm', 1_000, 0, { pinned: true }); // the shortest, but pinned
    fill(255, 5_000, 0);
    pauseModel('own-late', 'm', 60_000, 10);
    expect(pausedFor('server', 'm', 10)).toBeGreaterThan(0);
    expect(pausedFor('own-late', 'm', 10)).toBeGreaterThan(0);
    // Exactly one unpinned pause made room.
    const alive = Array.from({ length: 255 }, (_, i) => pausedFor(`own-${i}`, 'm', 10)).filter(
      (ms) => ms > 0,
    );
    expect(alive).toHaveLength(254);
  });
});
