import { describe, expect, it } from 'vitest';
import { getGeminiKey, setGeminiKey } from './byok';
import { clearDeviceData } from './device-data';
import { draftStoreFor } from '@/features/journal-core/editor/registry';
import { loadTodayPointer, saveTodayPointer } from '@/features/journal-core/editor/draftStore';
import { emptyFields } from '@/features/journal-core/editor/syncEngine';

const draft = (id: string, body: string) => ({
  id,
  fields: { ...emptyFields('2026-10-13'), body },
  synced: null,
  version: null,
  updatedAt: 1,
});

describe('clearDeviceData', () => {
  it('removes the BYOK key plus the user’s drafts, queue and Today pointer, and nobody else’s', async () => {
    setGeminiKey('AIzaSyD-test-key-1234567890abcdefghijk');
    await draftStoreFor('leaving').save(draft('11111111-0000-4000-8000-000000000001', 'private'));
    await saveTodayPointer('leaving', { date: '2026-10-13', id: '11111111-0000-4000-8000-000000000001' });
    await draftStoreFor('staying').save(draft('22222222-0000-4000-8000-000000000002', 'theirs'));

    await clearDeviceData('leaving');

    expect(getGeminiKey()).toBeNull();
    expect(await draftStoreFor('leaving').list()).toEqual([]);
    expect(await loadTodayPointer('leaving')).toBeUndefined();
    expect(await draftStoreFor('staying').list()).toHaveLength(1);
  });

  it('on a normal sign-out keeps drafts the server never received', async () => {
    setGeminiKey('AIzaSyD-test-key-1234567890abcdefghijk');
    await draftStoreFor('offline').save(draft('44444444-0000-4000-8000-000000000004', 'unsent'));
    await clearDeviceData('offline', { keepUnsyncedDrafts: true });
    expect(getGeminiKey()).toBeNull();
    expect(await draftStoreFor('offline').list()).toHaveLength(1);
  });

  it('without a user (expired session) only forgets the BYOK key', async () => {
    setGeminiKey('AIzaSyD-test-key-1234567890abcdefghijk');
    await draftStoreFor('expired').save(draft('33333333-0000-4000-8000-000000000003', 'keep me'));
    await clearDeviceData(null);
    expect(getGeminiKey()).toBeNull();
    expect(await draftStoreFor('expired').list()).toHaveLength(1);
  });
});
