import { addDays, type Chapter } from '@solace/shared';

export const MIN_BLOCK_PX = 176;
export const LANE_H = 196;
export const LANE_GAP = 12;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export type Placed = { chapter: Chapter; left: number; width: number; lane: number; to: string; ongoing: boolean };
export type Tick = { left: number; label: string; major: boolean };
export type TimelineLayout = { items: Placed[]; width: number; lanes: number; ticks: Tick[]; from: string; to: string };

/**
 * Lays chapters out on a time axis. Each chapter's width follows its length (at least a readable
 * minimum); overlapping blocks drop to the next lane, so nothing is ever hidden.
 */
export function layoutChapters(chapters: Chapter[], today: string, pxPerDay: number): TimelineLayout {
  if (chapters.length === 0) return { items: [], width: 0, lanes: 0, ticks: [], from: today, to: today };
  const sorted = chapters.slice().sort((a, b) => a.from.localeCompare(b.from));
  const from = sorted[0]!.from;
  const end = sorted.reduce((m, c) => ((c.to ?? today) > m ? (c.to ?? today) : m), from);
  const laneEnds: number[] = [];
  const items: Placed[] = sorted.map((chapter) => {
    const to = chapter.to ?? today;
    const left = Math.round(daysBetween(from, chapter.from) * pxPerDay);
    const width = Math.max(MIN_BLOCK_PX, Math.round((daysBetween(chapter.from, to) + 1) * pxPerDay));
    let lane = laneEnds.findIndex((e) => e <= left);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = left + width;
    return { chapter, left, width, lane, to, ongoing: chapter.to === null };
  });
  const width = Math.max(...items.map((i) => i.left + i.width)) + 24;
  return { items, width, lanes: laneEnds.length, ticks: monthTicks(from, end, pxPerDay), from, to: end };
}

function monthTicks(from: string, to: string, pxPerDay: number): Tick[] {
  const ticks: Tick[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  // Label only as many months as fit: a "Jan 2026" tick needs about 72px before the next one.
  const step = [1, 2, 3, 6, 12].find((n) => n * 30.4 * pxPerDay >= 72) ?? 12;
  let guard = 0;
  while (cursor <= to && guard++ < 600) {
    const month = Number(cursor.slice(5, 7));
    if ((month - 1) % step === 0) {
      const label = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: month === 1 ? 'numeric' : undefined,
        timeZone: 'UTC',
      }).format(new Date(`${cursor}T12:00:00Z`));
      ticks.push({ left: Math.max(0, Math.round(daysBetween(from, cursor) * pxPerDay)), major: month === 1, label });
    }
    cursor = addDays(`${cursor.slice(0, 7)}-28`, 4).slice(0, 7) + '-01';
  }
  return ticks;
}

export const ZOOMS = [0.35, 0.7, 1.4, 2.8] as const;
export function clampZoom(i: number): number {
  return Math.min(ZOOMS.length - 1, Math.max(0, i));
}

/** The CSS colour for a chapter's role token, falling back to the accent. */
const ROLES = new Set(['mood-1', 'mood-2', 'mood-3', 'mood-4', 'mood-5', 'accent', 'ai']);
export function roleVar(color: string): string {
  const role = color.replace(/^--/, '').trim();
  return `var(--${ROLES.has(role) ? role : 'accent'})`;
}
