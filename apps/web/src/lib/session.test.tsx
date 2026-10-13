import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const session = { user: { id: 'user-1', email: 'maya@example.com' }, access_token: 't' };

vi.mock('./supabase-lazy', () => ({
  getSupabase: async () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session } }),
      signOut: async () => {
        order.push('supabase.signOut');
        return { error: null };
      },
    },
  }),
}));

vi.mock('./device-data', () => ({
  syncBeforeSignOut: vi.fn(async (userId: string) => void order.push(`sync:${userId}`)),
  clearDeviceData: vi.fn(
    async (userId: string | null, opts?: { keepUnsyncedDrafts?: boolean }) =>
      void order.push(`clear:${userId}${opts?.keepUnsyncedDrafts ? ':keep-unsynced' : ''}`),
  ),
}));

const { SessionProvider, useSession } = await import('./session');
const { fireUnauthorized } = await import('./auth-events');

const probe: { current: ReturnType<typeof useSession> | null } = { current: null };
function Probe() {
  const value = useSession();
  useEffect(() => {
    probe.current = value;
  });
  return null;
}

async function mount() {
  // Off the public pages the auth SDK loads immediately.
  window.history.pushState({}, '', '/app');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(probe.current?.status).toBe('signed-in'));
}

describe('sign-out clears this browser for the next person', () => {
  beforeEach(() => {
    order.length = 0;
    probe.current = null;
  });

  it('a normal sign-out syncs unsaved drafts first, then clears the BYOK key and drafts', async () => {
    await mount();
    await act(() => probe.current!.signOut());
    expect(order).toEqual(['sync:user-1', 'supabase.signOut', 'clear:user-1:keep-unsynced']);
    expect(probe.current!.status).toBe('signed-out');
  });

  it('account deletion clears everything without trying to sync', async () => {
    await mount();
    await act(() => probe.current!.signOut({ scope: 'local', reason: 'deleted' }));
    expect(order).toEqual(['supabase.signOut', 'clear:user-1']);
  });

  it('a 401 (expired session) clears the BYOK key but keeps the drafts for the same person', async () => {
    await mount();
    await act(async () => {
      fireUnauthorized();
      await waitFor(() => expect(order).toContain('clear:null'));
    });
    expect(order).toEqual(['supabase.signOut', 'clear:null']);
  });
});
