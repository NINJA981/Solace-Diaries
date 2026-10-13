import { describe, expect, it } from 'vitest';
import {
  addDays,
  countWords,
  createSseParser,
  daysBetween,
  encodeSse,
  isoDate,
  localDate,
  weekStart,
} from './index';

describe('time helpers', () => {
  it('computes local dates across the date line', () => {
    const at = new Date('2026-03-01T06:30:00Z');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-02-28');
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-03-01');
  });

  it('adds days across DST and month/leap boundaries', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-13')).toBe('2026-10-12'); // Tuesday → Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday → previous Monday
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('counts words', () => {
    expect(countWords('  ')).toBe(0);
    expect(countWords('one  two\nthree')).toBe(3);
  });
});

describe('sse', () => {
  it('parses events split across chunks', () => {
    const push = createSseParser();
    const wire = encodeSse('token', { text: 'hel' }) + encodeSse('token', { text: 'lo' });
    const a = push(wire.slice(0, 10));
    const b = push(wire.slice(10));
    expect([...a, ...b].map((e) => JSON.parse(e.data).text)).toEqual(['hel', 'lo']);
  });
});

describe('isoDate', () => {
  it('accepts real calendar dates, including leap days and early years', () => {
    for (const d of ['2024-02-29', '2026-12-31', '2026-01-01', '0001-01-01', '0099-06-15']) {
      expect(isoDate.safeParse(d).success, d).toBe(true);
    }
  });

  it('rejects impossible or malformed dates', () => {
    for (const d of [
      '2024-02-31',
      '2023-02-29',
      '2024-13-01',
      '2024-00-10',
      '2024-04-31',
      '2024-01-00',
      '0000-01-01',
      '2024-1-01',
      '2024-01-01T00:00:00Z',
    ]) {
      expect(isoDate.safeParse(d).success, d).toBe(false);
    }
  });
});
