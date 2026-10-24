import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/errors';
import { aiErrorCopy } from './aiErrors';
import { monthTitle, writeState } from './letterState';

const letter = { id: '00000000-0000-4000-8000-000000000001', month: '2026-10', content: 'x', citations: [], replyEntryId: null, createdAt: '2026-10-01T00:00:00.000Z' };

describe('letter write state', () => {
  it('can write when the API says so', () => {
    expect(writeState({ items: [], canWrite: true, minEntries: 8 }, '2026-10')).toEqual({ canWrite: true, reason: null });
  });
  it('explains an existing month letter', () => {
    const s = writeState({ items: [letter], canWrite: false, minEntries: 8 }, '2026-10');
    expect(s.canWrite).toBe(false);
    expect(s.reason).toMatch(/already written/);
  });
  it('explains missing older entries with the minimum', () => {
    const s = writeState({ items: [], canWrite: false, minEntries: 8 }, '2026-10');
    expect(s.reason).toMatch(/at least 8 entries older than about three months/);
  });
  it('titles months', () => {
    expect(monthTitle('2026-10')).toBe('October 2026');
  });
});

describe('AI error copy', () => {
  it('does not assume the person spent their own budget', () => {
    for (const err of [new ApiRequestError(429, 'x', 'ai_quota_exceeded'), new ApiRequestError(429, 'x', 'rate_limited')]) {
      const c = aiErrorCopy(err, 'the letter');
      expect(c.message).toMatch(/shared/);
      expect(c.message).not.toMatch(/you’ve used|your allowance|you have used/i);
      expect(c.message).toMatch(/later/);
      expect(c.message).toMatch(/Gemini key in Settings/);
      expect(c.suggestKey).toBe(true);
    }
  });
  it('handles 503 and unknown errors', () => {
    expect(aiErrorCopy(new ApiRequestError(503, 'x', 'ai_unavailable'), 'the letter').message).toMatch(/can’t reach/);
    expect(aiErrorCopy(new ApiRequestError(500, 'Boom')).message).toBe('Boom');
  });
});
