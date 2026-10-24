import { describe, expect, it } from 'vitest';
import type { Capsule } from '@solace/shared';
import { addMonths, capsuleStatus, earliestDate, localInstant, presetDate, sortCapsules, timeUntil, validateDraft, validateUnlock } from './capsuleLogic';

const NOW = new Date('2026-10-14T14:00:00Z');
const TZ = 'Europe/London';
const cap = (o: Partial<Capsule>): Capsule => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 't',
  body: null,
  unlockAt: '2027-01-01T09:00:00.000Z',
  status: 'sealed',
  openedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  ...o,
});

describe('presets', () => {
  it('adds months and clamps short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-14', 6)).toBe('2027-04-14');
    expect(presetDate('1y', '2026-10-14')).toBe('2027-10-14');
    expect(presetDate('1m', '2026-12-20')).toBe('2027-01-20');
  });
  it('converts a local date to an instant in the zone', () => {
    expect(localInstant('2026-07-01', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(localInstant('2026-12-01', 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(localInstant('2026-12-01', 'Asia/Kolkata').toISOString()).toBe('2026-12-01T03:30:00.000Z');
  });
});

describe('validation', () => {
  it('rejects tomorrow morning inside 24h and accepts the day after', () => {
    expect(validateUnlock('2026-10-15', NOW, TZ)).toMatch(/24 hours/);
    expect(validateUnlock('2026-10-16', NOW, TZ)).toBeNull();
    expect(earliestDate(NOW, TZ)).toBe('2026-10-16');
  });
  it('rejects more than 25 years and bad input', () => {
    expect(validateUnlock('2052-10-14', NOW, TZ)).toMatch(/25 years/);
    expect(validateUnlock('2051-10-14', NOW, TZ)).toBeNull();
    expect(validateUnlock('', NOW, TZ)).toMatch(/Choose/);
  });
  it('reports each missing field', () => {
    expect(validateDraft({ title: ' ', body: '', date: '' }, NOW, TZ)).toEqual({
      title: expect.any(String),
      body: expect.any(String),
      date: expect.any(String),
    });
    expect(validateDraft({ title: 'Hi', body: 'x', date: '2027-01-01' }, NOW, TZ)).toEqual({});
  });
});

describe('state', () => {
  it('upgrades sealed to ready on the local clock and keeps opened', () => {
    expect(capsuleStatus(cap({}), NOW)).toBe('sealed');
    expect(capsuleStatus(cap({ unlockAt: '2026-10-01T09:00:00.000Z' }), NOW)).toBe('ready');
    expect(capsuleStatus(cap({ status: 'opened', unlockAt: '2026-10-01T09:00:00.000Z' }), NOW)).toBe('opened');
  });
  it('sorts ready, sealed soonest, opened', () => {
    const a = cap({ id: 'a', unlockAt: '2027-06-01T09:00:00.000Z' });
    const b = cap({ id: 'b', unlockAt: '2027-01-01T09:00:00.000Z' });
    const c = cap({ id: 'c', status: 'opened', openedAt: '2026-09-01T00:00:00.000Z', body: 'x' });
    const d = cap({ id: 'd', unlockAt: '2026-09-01T09:00:00.000Z' });
    expect(sortCapsules([a, c, b, d], NOW).map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('words time until calmly', () => {
    expect(timeUntil('2026-10-14T20:00:00Z', NOW)).toBe('later today');
    expect(timeUntil('2026-10-26T14:00:00Z', NOW)).toBe('in 12 days');
    expect(timeUntil('2027-04-14T14:00:00Z', NOW)).toBe('in 6 months');
    expect(timeUntil('2029-10-14T14:00:00Z', NOW)).toBe('in 3 years');
  });
});
