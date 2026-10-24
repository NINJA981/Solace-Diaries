import { describe, expect, it } from 'vitest';
import { THREAD_MODES } from '@solace/shared';
import { MODE_OPTIONS, createThreadPayload, modeLabel } from './modes';

describe('guided reflection modes', () => {
  it('offers every mode the contract knows, each with a one-line description', () => {
    expect(MODE_OPTIONS.map((m) => m.mode)).toEqual([...THREAD_MODES]);
    for (const m of MODE_OPTIONS) expect(m.description).not.toMatch(/\n/);
  });
  it('sends mode only for guided reflections', () => {
    expect(createThreadPayload('open', 'Hello')).toEqual({ title: 'Hello' });
    expect(createThreadPayload('gratitude', 'Gratitude')).toEqual({ title: 'Gratitude', mode: 'gratitude' });
    expect(createThreadPayload('reframe')).toEqual({ mode: 'reframe' });
  });
  it('shows a header label for guided modes only', () => {
    expect(modeLabel('open')).toBeNull();
    expect(modeLabel(undefined)).toBeNull();
    expect(modeLabel('unsent_letter')).toBe('Unsent letter');
  });
});
