import { describe, expect, it } from 'vitest';
import { daylightAt } from './daylight';
import { litPath, moonPhase } from './moon';

const utc = (y: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));

describe('moonPhase', () => {
  it('is new on 2000-01-06', () => {
    const p = moonPhase(utc(2000, 1, 6, 18, 14));
    expect(p.illuminated).toBeLessThan(0.02);
    expect(p.name).toBe('New moon');
  });
  it('is full on 2000-01-21', () => {
    const p = moonPhase(utc(2000, 1, 21, 4, 40));
    expect(p.illuminated).toBeGreaterThan(0.98);
    expect(p.name).toBe('Full moon');
  });
  it('matches 2026 new and full moons', () => {
    expect(moonPhase(utc(2026, 10, 10, 15, 50)).illuminated).toBeLessThan(0.02);
    expect(moonPhase(utc(2026, 10, 26, 4, 12)).illuminated).toBeGreaterThan(0.98);
    expect(moonPhase(utc(2026, 12, 24, 1, 28)).illuminated).toBeGreaterThan(0.98);
  });
  it('waxes then wanes through a month', () => {
    const a = moonPhase(utc(2026, 10, 14, 12));
    expect(a.waxing).toBe(true);
    expect(a.name).toBe('Waxing crescent');
    expect(moonPhase(utc(2026, 10, 20, 12)).name).toBe('Waxing gibbous');
    expect(moonPhase(utc(2026, 10, 30, 12)).name).toBe('Waning gibbous');
    expect(moonPhase(utc(2026, 11, 5, 12)).name).toBe('Waning crescent');
    expect(moonPhase(utc(2026, 10, 30, 12)).waxing).toBe(false);
  });
  it('reports quarters near their time', () => {
    expect(moonPhase(utc(2026, 10, 18, 0, 0)).illuminated).toBeGreaterThan(0.4);
    expect(moonPhase(utc(2026, 10, 18, 0, 0)).illuminated).toBeLessThan(0.62);
  });
  it('keeps age in range', () => {
    for (let i = 0; i < 60; i++) {
      const p = moonPhase(utc(2026, 1, 1 + i * 6));
      expect(p.age).toBeGreaterThanOrEqual(0);
      expect(p.age).toBeLessThan(29.54);
    }
  });
});

describe('litPath', () => {
  it('draws nothing for a new moon and a full disc for a full moon', () => {
    expect(litPath({ cycle: 0, waxing: true, illuminated: 0 }, 0, 0, 10)).toBeNull();
    expect(litPath({ cycle: 0.5, waxing: false, illuminated: 1 }, 0, 0, 10)).toContain('a10 10');
  });
  it('flips sides between waxing and waning', () => {
    const waxing = litPath({ cycle: 0.1, waxing: true, illuminated: 0.1 }, 0, 0, 10)!;
    const waning = litPath({ cycle: 0.9, waxing: false, illuminated: 0.1 }, 0, 0, 10)!;
    expect(waxing).toContain('A10 10 0 0 1');
    expect(waning).toContain('A10 10 0 0 0');
  });
  it('flattens the terminator at a quarter', () => {
    expect(litPath({ cycle: 0.25, waxing: true, illuminated: 0.5 }, 0, 0, 10)).toMatch(/A[0-9.e-]+ 10 0 0 \d 0 -10Z/);
  });
});

describe('daylightAt', () => {
  it('has the four parts', () => {
    expect(daylightAt(2).part).toBe('night');
    expect(daylightAt(6.5).part).toBe('dawn');
    expect(daylightAt(13).part).toBe('day');
    expect(daylightAt(19).part).toBe('dusk');
    expect(daylightAt(23).part).toBe('night');
  });
  it('is dark at midnight, light at noon, and glows between', () => {
    expect(daylightAt(0).night).toBeCloseTo(1, 2);
    expect(daylightAt(12.5).night).toBeCloseTo(0, 2);
    expect(daylightAt(19).glow).toBeGreaterThan(0.9);
    expect(daylightAt(13).glow).toBeLessThan(0.05);
  });
  it('wraps the hour', () => {
    expect(daylightAt(25).hour).toBeCloseTo(1);
    expect(daylightAt(-1).hour).toBeCloseTo(23);
  });
});
