import type { Unwrapped, UnwrappedSlide, JournalPersona } from '@solace/shared';
import { addDays } from '@solace/shared';

export type StorySlide =
  | { id: string; label: string; kind: 'slide'; slide: UnwrappedSlide }
  | { id: string; label: string; kind: 'persona'; persona: JournalPersona };

const LABELS: Record<UnwrappedSlide['kind'], string> = {
  totals: 'Totals',
  moods: 'Moods',
  tags: 'Themes',
  streak: 'Streak',
  rhythm: 'Rhythm',
  bookends: 'First and last',
  people: 'People',
  highlight: 'Highlight',
};

/** The month before `today` (YYYY-MM): the last full month. */
export function defaultMonth(today: string): string {
  const first = `${today.slice(0, 7)}-01`;
  return addDays(first, -1).slice(0, 7);
}

/** Month keys, newest first, from the last full month back `count` months. */
export function monthOptions(today: string, count = 18): string[] {
  const out: string[] = [];
  let cursor = defaultMonth(today);
  for (let i = 0; i < count; i++) {
    out.push(cursor);
    cursor = addDays(`${cursor}-01`, -1).slice(0, 7);
  }
  return out;
}

export function yearOptions(today: string, count = 4): string[] {
  const y = Number(today.slice(0, 4));
  return Array.from({ length: count }, (_, i) => String(y - i));
}

export function isNotEnough(data: Unwrapped): boolean {
  return data.persona === null || data.slides.length === 0;
}

/** Turns the API slides into the story: drops slides with nothing to say and ends with the persona card. */
export function buildStory(data: Unwrapped, opts: { teen?: boolean } = {}): StorySlide[] {
  if (isNotEnough(data) || data.persona === null) return [];
  const out: StorySlide[] = [];
  for (const slide of data.slides) {
    if (slide.kind === 'streak' && opts.teen) continue;
    if (slide.kind === 'people' && (opts.teen || slide.top.length === 0)) continue;
    if (slide.kind === 'tags' && slide.top.length === 0) continue;
    if (slide.kind === 'moods' && Object.values(slide.counts).every((n) => n === 0)) continue;
    if (slide.kind === 'bookends' && !slide.first && !slide.last) continue;
    out.push({ id: slide.kind, label: LABELS[slide.kind], kind: 'slide', slide });
  }
  out.push({ id: 'persona', label: 'Your persona', kind: 'persona', persona: data.persona });
  return out;
}

// ───────────────────────── navigation state ─────────────────────────

export type NavState = { index: number; count: number };
export type NavAction = 'next' | 'prev' | 'first' | 'last' | { to: number };

export function navReduce(s: NavState, a: NavAction): NavState {
  const max = Math.max(0, s.count - 1);
  const clamp = (n: number) => Math.min(max, Math.max(0, n));
  switch (a) {
    case 'next':
      return { ...s, index: clamp(s.index + 1) };
    case 'prev':
      return { ...s, index: clamp(s.index - 1) };
    case 'first':
      return { ...s, index: 0 };
    case 'last':
      return { ...s, index: max };
    default:
      return { ...s, index: clamp(a.to) };
  }
}

/** Maps a key to a navigation action, or null when the key isn't ours. */
export function keyToNav(key: string): NavAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** Swipe: a horizontal drag past the threshold that dominates the vertical one. */
export function swipeToNav(dx: number, dy: number, threshold = 48): NavAction | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** The hour (0-23) as a short label: "9 am", "12 pm". */
export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${suffix}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
