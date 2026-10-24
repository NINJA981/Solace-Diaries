import { describe, expect, it } from 'vitest';
import { localDate } from '@solace/shared';
import { stripFor, weekCount, weekDates, weekdayOf } from './weekStrip';

describe('week strip', () => {
  it('is today and six days back, oldest first', () => {
    expect(weekDates('2026-03-02')).toEqual([
      '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
    ]);
  });
  it('crosses a leap day', () => {
    expect(weekDates('2028-03-02')[0]).toBe('2028-02-25');
  });
  it('uses the person’s local date, not the viewer’s', () => {
    const at = new Date('2026-10-14T23:30:00Z');
    expect(localDate(at, 'Pacific/Auckland')).toBe('2026-10-15');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-10-14');
    expect(weekDates(localDate(at, 'Pacific/Auckland')).at(-1)).toBe('2026-10-15');
  });
  it('names weekdays regardless of timezone', () => {
    expect(weekdayOf('2026-10-14')).toBe('Wed');
    expect(weekdayOf('2026-10-14', 'long')).toBe('Wednesday');
  });
  it('marks checked days and today, with no missed state', () => {
    const strip = stripFor({ checkins: [{ date: '2026-10-14', note: null }, { date: '2026-10-12', note: null }, { date: '2026-08-01', note: null }] }, '2026-10-14');
    expect(strip.filter((d) => d.checked).map((d) => d.date)).toEqual(['2026-10-12', '2026-10-14']);
    expect(strip.at(-1)).toMatchObject({ isToday: true, label: 'Wednesday 14' });
    expect(Object.keys(strip[0]!)).not.toContain('missed');
    expect(weekCount({ checkins: [{ date: '2026-10-14', note: null }] }, '2026-10-14')).toBe(1);
  });
});
