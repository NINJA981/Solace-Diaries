import { describe, expect, it } from 'vitest';
import { addDays, countWords, createSseParser, daysBetween, encodeSse, localDate, weekStart } from './index';

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
