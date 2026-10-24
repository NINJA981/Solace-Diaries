import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, buildInput, clearDraft, currentWeek, hasAnswer, isDone, isSunday, loadDraft, markDone, saveDraft } from './ritualLogic';

beforeEach(() => localStorage.clear());

describe('isSunday', () => {
  it('uses the person’s timezone', () => {
    const t = new Date('2026-10-18T12:00:00Z'); // Sunday noon in London, Monday in Auckland
    expect(isSunday(t, 'Europe/London')).toBe(true);
    expect(isSunday(t, 'Pacific/Auckland')).toBe(false);
    expect(isSunday(new Date('2026-10-14T12:00:00Z'), 'Europe/London')).toBe(false);
  });
  it('names the week by its Monday', () => {
    expect(currentWeek(new Date('2026-10-18T12:00:00Z'), 'Europe/London')).toBe('2026-10-12');
  });
});

describe('input', () => {
  it('needs at least one answer', () => {
    expect(hasAnswer(EMPTY_DRAFT)).toBe(false);
    expect(buildInput({ ...EMPTY_DRAFT, highs: '  ' }, 'UTC')).toBeNull();
  });
  it('builds an intention only when one was written', () => {
    expect(buildInput({ ...EMPTY_DRAFT, highs: ' Good run ' }, 'UTC')).toEqual({ highs: 'Good run', lows: '', tz: 'UTC' });
    expect(buildInput({ ...EMPTY_DRAFT, intention: 'Call Gran', cadence: 'weekly' }, 'UTC')?.intention).toEqual({
      title: 'Call Gran',
      kind: 'goal',
      cadence: 'weekly',
    });
  });
});

describe('draft persistence', () => {
  it('survives a reload, per person, until cleared', () => {
    saveDraft('u1', { step: 1, highs: 'a', lows: 'b', intention: '', cadence: 'daily' });
    expect(loadDraft('u1')).toEqual({ step: 1, highs: 'a', lows: 'b', intention: '', cadence: 'daily' });
    expect(loadDraft('u2')).toEqual(EMPTY_DRAFT);
    clearDraft('u1');
    expect(loadDraft('u1')).toEqual(EMPTY_DRAFT);
  });
  it('does not store an empty draft and survives garbage', () => {
    saveDraft('u1', { ...EMPTY_DRAFT, step: 2 });
    expect(localStorage.length).toBe(0);
    localStorage.setItem('solace.ritual-draft:u1', '{not json');
    expect(loadDraft('u1')).toEqual(EMPTY_DRAFT);
  });
  it('remembers the week that is done', () => {
    expect(isDone('u1', '2026-10-12')).toBe(false);
    markDone('u1', '2026-10-12');
    expect(isDone('u1', '2026-10-12')).toBe(true);
    expect(isDone('u1', '2026-10-19')).toBe(false);
  });
});
