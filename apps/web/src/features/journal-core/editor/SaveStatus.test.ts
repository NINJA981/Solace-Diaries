import { describe, expect, it } from 'vitest';
import { statusText } from './SaveStatus';
import { emptyFields, type EngineSnapshot } from './syncEngine';

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  id: 'e1',
  fields: emptyFields('2026-10-13'),
  status: 'saved',
  conflict: null,
  error: null,
  version: 1,
  dirty: false,
  lastSavedAt: null,
  ...over,
});

describe('statusText', () => {
  it('describes every save state in plain sentences', () => {
    expect(statusText(snap({ status: 'empty' }))).toBe('');
    expect(statusText(snap({ status: 'saving' }))).toBe('Saving…');
    expect(statusText(snap({ status: 'saved' }))).toBe('Saved');
    expect(statusText(snap({ status: 'offline' }))).toBe('Offline. Saved on this device');
    expect(statusText(snap({ status: 'retrying' }))).toBe('Couldn’t save. Retrying…');
    expect(statusText(snap({ status: 'conflict' }))).toBe('Two versions. Choose one');
    expect(statusText(snap({ status: 'failed', error: 'This entry is too long.' }))).toBe(
      'Couldn’t save. This entry is too long.',
    );
  });

  it('never uses a spaced em dash', () => {
    for (const status of ['offline', 'retrying', 'conflict', 'failed'] as const) {
      expect(statusText(snap({ status, error: 'x' }))).not.toContain(' — ');
    }
  });
});
