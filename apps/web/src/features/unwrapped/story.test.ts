import { describe, expect, it } from 'vitest';
import type { Unwrapped } from '@solace/shared';
import { buildStory, defaultMonth, hourLabel, isNotEnough, keyToNav, monthOptions, navReduce, swipeToNav } from './story';

const entry = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'x',
  entryDate: '2026-09-02',
  mood: null,
  moodSource: null,
  tags: [],
  summary: null,
  wordCount: 3,
  version: 1,
  enrichmentStatus: 'ready',
  createdAt: '2026-09-02T08:00:00.000Z',
  updatedAt: '2026-09-02T08:00:00.000Z',
  excerpt: 'x',
  attachmentCount: 0,
} as never;

const base: Unwrapped = {
  period: 'month',
  label: 'September 2026',
  from: '2026-09-01',
  to: '2026-09-30',
  minEntries: 5,
  persona: { key: 'night', name: 'Night-owl processor', description: 'd', traits: ['a'] },
  slides: [
    { kind: 'totals', entries: 12, words: 900, days: 9 },
    { kind: 'moods', counts: { calm: 3 }, top: 'calm' },
    { kind: 'tags', top: [] },
    { kind: 'people', top: [{ name: 'Mia', count: 3 }] },
    { kind: 'highlight', entry, reason: 'r' },
  ],
};

describe('unwrapped story', () => {
  it('maps slides, drops empty ones and ends with the persona', () => {
    const story = buildStory(base);
    expect(story.map((s) => s.id)).toEqual(['totals', 'moods', 'people', 'highlight', 'persona']);
    expect(story.at(-1)?.kind).toBe('persona');
  });
  it('never includes people in teen mode', () => {
    expect(buildStory(base, { teen: true }).map((s) => s.id)).not.toContain('people');
  });
  it('is empty when there are too few entries', () => {
    const thin = { ...base, persona: null, slides: [] };
    expect(isNotEnough(thin)).toBe(true);
    expect(buildStory(thin)).toEqual([]);
  });
  it('picks the last full month, across year ends', () => {
    expect(defaultMonth('2026-10-14')).toBe('2026-09');
    expect(defaultMonth('2026-01-03')).toBe('2025-12');
    expect(monthOptions('2026-03-01', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });
  it('clamps navigation', () => {
    let s = { index: 0, count: 3 };
    s = navReduce(s, 'prev');
    expect(s.index).toBe(0);
    s = navReduce(navReduce(navReduce(s, 'next'), 'next'), 'next');
    expect(s.index).toBe(2);
    expect(navReduce(s, 'first').index).toBe(0);
    expect(navReduce(s, { to: 99 }).index).toBe(2);
    expect(navReduce({ index: 0, count: 0 }, 'next').index).toBe(0);
  });
  it('maps keys and swipes', () => {
    expect(keyToNav('ArrowRight')).toBe('next');
    expect(keyToNav('ArrowLeft')).toBe('prev');
    expect(keyToNav('x')).toBeNull();
    expect(swipeToNav(-80, 5)).toBe('next');
    expect(swipeToNav(80, 5)).toBe('prev');
    expect(swipeToNav(-20, 0)).toBeNull();
    expect(swipeToNav(-60, 90)).toBeNull();
  });
  it('labels hours', () => {
    expect(hourLabel(0)).toBe('12 am');
    expect(hourLabel(13)).toBe('1 pm');
  });
});
