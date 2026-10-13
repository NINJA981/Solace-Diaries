import { describe, expect, it } from 'vitest';
import { addMonths, monthEnd, monthGrid, monthLabelColumns, yearGrid } from './dates';

describe('month grid', () => {
  it('covers whole Monday-start weeks', () => {
    // March 2026: Mar 1 is a Sunday, Mar 31 a Tuesday.
    const grid = monthGrid('2026-03-15');
    expect(grid[0]![0]!.date).toBe('2026-02-23');
    expect(grid[0]![6]).toEqual({ date: '2026-03-01', inMonth: true });
    expect(grid.at(-1)!.at(-1)!.date).toBe('2026-04-05');
    expect(grid).toHaveLength(6);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('handles February in leap and non-leap years', () => {
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    // Feb 2027 starts on Monday and has 28 days → exactly 4 rows.
    expect(monthGrid('2027-02-01')).toHaveLength(4);
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-05-01', -17)).toBe('2024-12-01');
  });

  it('is DST-safe (no skipped or repeated days around clock changes)', () => {
    const days = monthGrid('2026-03-01').flat().map((c) => c.date);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2026-03-29'); // EU DST switch
    expect(days).toContain('2026-03-08'); // US DST switch
  });
});

describe('year heatmap grid', () => {
  it('is 53×7, Monday rows, ending in the week containing today', () => {
    const cells = yearGrid('2026-10-13'); // a Tuesday
    expect(cells).toHaveLength(53 * 7);
    const last = cells.filter((c) => c.col === 52);
    expect(last[0]!.date).toBe('2026-10-12'); // Monday
    expect(last[1]).toMatchObject({ date: '2026-10-13', future: false });
    expect(last[2]).toMatchObject({ date: '2026-10-14', future: true });
    expect(cells[0]!.date).toBe('2025-10-13');
    expect(new Set(cells.map((c) => c.date)).size).toBe(cells.length);
  });

  it('labels each month once, at the first column that starts in it', () => {
    const labels = monthLabelColumns(yearGrid('2026-10-13'));
    const months = labels.map((l) => l.month.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
    expect(months.at(-1)).toBe('2026-10');
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.col).toBeGreaterThan(labels[i - 1]!.col);
  });
});
