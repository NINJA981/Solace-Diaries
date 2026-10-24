import { beforeEach, describe, expect, it } from 'vitest';
import type { Milestone } from '@solace/shared';
import { achievedKeys, isSaveLanding, newMilestones, pickReaction, readSeen, writeSeen } from './companionLogic';

const ms = (key: string, achievedAt: string | null): Milestone => ({ key, title: key, description: '', achievedAt });

beforeEach(() => localStorage.clear());

describe('milestones', () => {
  const all = [ms('a', '2026-01-01T00:00:00Z'), ms('b', '2026-02-01T00:00:00Z'), ms('c', null)];
  it('never celebrates a backlog on first sight', () => {
    expect(newMilestones(all, null)).toEqual([]);
  });
  it('celebrates achieved milestones not yet seen', () => {
    expect(newMilestones(all, ['a']).map((m) => m.key)).toEqual(['b']);
    expect(newMilestones(all, ['a', 'b'])).toEqual([]);
  });
  it('remembers what was seen per person', () => {
    expect(readSeen('u1')).toBeNull();
    writeSeen('u1', achievedKeys(all));
    expect(readSeen('u1')).toEqual(['a', 'b']);
    expect(readSeen('u2')).toBeNull();
  });
});

describe('reactions', () => {
  it('lets a celebration outrank a save', () => {
    expect(pickReaction('celebrate', 'saved')).toBe('celebrate');
    expect(pickReaction('idle', 'saved')).toBe('saved');
    expect(pickReaction('saved', 'celebrate')).toBe('celebrate');
  });
  it('detects a save landing, not the initial state', () => {
    expect(isSaveLanding('saving', 'saved')).toBe(true);
    expect(isSaveLanding(undefined, 'saved')).toBe(false);
    expect(isSaveLanding('saved', 'saved')).toBe(false);
    expect(isSaveLanding('pending', 'saving')).toBe(false);
  });
});
