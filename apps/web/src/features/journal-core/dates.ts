/** Calendar math for the month grid (Journal) and the year heatmap (Insights). */
import { addDays, daysBetween, weekStart } from '@solace/shared';

/** First day (YYYY-MM-01) of the month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Shift a month (`YYYY-MM-01`) by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
}

/** Last day of the month containing `date`. */
export function monthEnd(date: string): string {
  return addDays(addMonths(monthStart(date), 1), -1);
}

export type MonthCell = { date: string; inMonth: boolean };

/**
 * A Monday-start month grid: whole weeks covering the month, so 4–6 rows of 7.
 * Cells outside the month are flagged `inMonth: false`.
 */
export function monthGrid(month: string): MonthCell[][] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const start = weekStart(first);
  const weeks: MonthCell[][] = [];
  let cursor = start;
  while (daysBetween(cursor, last) >= 0) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, inMonth: cursor.slice(0, 7) === first.slice(0, 7) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type HeatCell = { date: string; col: number; row: number; future: boolean };

/**
 * The year heatmap: 53 Monday-start week columns ending with the week that contains
 * `today`; rows are weekdays (0 = Monday). Days after `today` are marked `future`.
 */
export function yearGrid(today: string, weeks = 53): HeatCell[] {
  const lastWeek = weekStart(today);
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));
  const cells: HeatCell[] = [];
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const date = addDays(firstWeek, col * 7 + row);
      cells.push({ date, col, row, future: daysBetween(today, date) > 0 });
    }
  }
  return cells;
}

/** Column index at which each month starts in the heatmap (for month labels). */
export function monthLabelColumns(cells: HeatCell[]): { col: number; month: string }[] {
  const out: { col: number; month: string }[] = [];
  let seen = '';
  for (const c of cells) {
    if (c.row !== 0) continue;
    // A column is labelled with the month its Monday falls in, the first time it appears.
    const m = c.date.slice(0, 7);
    if (m !== seen) {
      seen = m;
      out.push({ col: c.col, month: c.date });
    }
  }
  // Drop a leading label that would be cramped against the next one.
  if (out.length > 1 && out[1]!.col - out[0]!.col < 3) out.shift();
  return out;
}
