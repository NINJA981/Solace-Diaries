/**
 * Live state of an answer being streamed, per thread. Kept outside React so it survives the
 * route change from /app/reflect to /app/reflect/:id and leaving/returning mid-answer.
 */
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ApiError, ChatMessage, Citation, ThreadWithMessages } from '@solace/shared';
import { ApiRequestError, api, errorMessage, isAbortError, streamMessage } from '@/lib/api';
import { qk } from '../journal-core/queries';

export type StreamStatus = 'streaming' | 'done' | 'stopped' | 'error';

export type StreamState = {
  status: StreamStatus;
  /** The question being asked (optimistic bubble until the server echoes it). */
  content: string;
  regenerate: boolean;
  /** Raw text received so far. */
  text: string;
  citations: Citation[];
  error: (ApiError & { status?: number }) | null;
  startedAt: number;
  /** Message ids already in the thread when this exchange started (no clock comparisons). */
  knownIds: string[];
  /** Server messages produced on `done` (used to avoid showing them twice). */
  userMessage: ChatMessage | null;
  message: ChatMessage | null;
};

const states = new Map<string, StreamState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function set(threadId: string, next: StreamState | null) {
  if (next) states.set(threadId, next);
  else states.delete(threadId);
  listeners.forEach((l) => l());
}

function patch(threadId: string, p: Partial<StreamState>) {
  const cur = states.get(threadId);
  if (cur) set(threadId, { ...cur, ...p });
}

export function useStream(threadId: string | undefined): StreamState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (threadId ? (states.get(threadId) ?? null) : null),
  );
}

export function isStreaming(threadId: string): boolean {
  return states.get(threadId)?.status === 'streaming';
}

export function clearStream(threadId: string) {
  if (!isStreaming(threadId)) set(threadId, null);
}

/** Merge a finished exchange into the cached thread. */
function applyDone(qc: QueryClient, threadId: string, s: StreamState, message: ChatMessage, userMessage: ChatMessage | null) {
  qc.setQueryData<ThreadWithMessages>(qk.thread(threadId), (t) => {
    if (!t) return t;
    let msgs = t.messages.filter((m) => m.id !== message.id && m.id !== userMessage?.id);
    if (s.regenerate) {
      // The regenerated answer replaces the previous last answer.
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant && msgs.at(-1)?.id === lastAssistant.id) msgs = msgs.slice(0, -1);
    }
    return { ...t, messages: [...msgs, ...(userMessage ? [userMessage] : []), message], updatedAt: message.createdAt };
  });
  void qc.invalidateQueries({ queryKey: qk.threads });
}

/**
 * Send a question (or regenerate the last answer) and stream the reply. Tokens are
 * accumulated raw; the view decides what is stable enough to render.
 */
export async function sendMessage(
  qc: QueryClient,
  threadId: string,
  content: string,
  opts: { regenerate?: boolean } = {},
): Promise<void> {
  if (isStreaming(threadId)) return;
  const ctrl = new AbortController();
  controllers.set(threadId, ctrl);
  const base: StreamState = {
    status: 'streaming',
    content,
    regenerate: !!opts.regenerate,
    text: '',
    citations: [],
    error: null,
    startedAt: Date.now(),
    knownIds: qc.getQueryData<ThreadWithMessages>(qk.thread(threadId))?.messages.map((m) => m.id) ?? [],
    userMessage: null,
    message: null,
  };
  set(threadId, base);

  // Coalesce token events into at most one store update per animation frame.
  let pendingText = '';
  let frame = 0;
  const flushTokens = () => {
    frame = 0;
    if (!pendingText) return;
    const cur = states.get(threadId);
    if (cur?.status === 'streaming') patch(threadId, { text: cur.text + pendingText });
    pendingText = '';
  };
  const schedule = () => {
    if (frame) return;
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flushTokens) : (setTimeout(flushTokens, 16) as unknown as number);
  };

  try {
    await streamMessage(
      threadId,
      { content, ...(opts.regenerate ? { regenerate: true } : {}) },
      {
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.event === 'sources') patch(threadId, { citations: e.data.citations });
          else if (e.event === 'token') {
            pendingText += e.data.text;
            schedule();
          } else if (e.event === 'done') {
            flushTokens();
            const cur = states.get(threadId) ?? base;
            const done: StreamState = {
              ...cur,
              status: 'done',
              text: e.data.message.content,
              citations: e.data.message.citations,
              userMessage: e.data.userMessage,
              message: e.data.message,
            };
            set(threadId, done);
            applyDone(qc, threadId, done, e.data.message, e.data.userMessage);
          } else if (e.event === 'error') {
            flushTokens();
            patch(threadId, { status: 'error', error: e.data });
          }
        },
      },
    );
  } catch (err) {
    flushTokens();
    if (isAbortError(err)) {
      patch(threadId, { status: 'stopped' });
    } else {
      patch(threadId, {
        status: 'error',
        error: {
          error: errorMessage(err),
          code: err instanceof ApiRequestError ? err.code : undefined,
          status: err instanceof ApiRequestError ? err.status : undefined,
        },
      });
    }
  } finally {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    controllers.delete(threadId);
    const s = states.get(threadId);
    // The server may have stored the question (and a partial answer) before failing.
    if (s && (s.status === 'error' || s.status === 'stopped')) void qc.invalidateQueries({ queryKey: qk.thread(threadId) });
  }
}

export function stopStream(threadId: string) {
  controllers.get(threadId)?.abort();
}

/**
 * Retry after an error or stop without duplicating the question: if the server already
 * stored it as the latest message, regenerate the answer to it instead of asking again.
 */
export async function retryStream(qc: QueryClient, threadId: string) {
  const s = states.get(threadId);
  if (!s) return;
  let thread = qc.getQueryData<ThreadWithMessages>(qk.thread(threadId));
  try {
    thread = await qc.fetchQuery({
      queryKey: qk.thread(threadId),
      queryFn: ({ signal }) => api.getThread({ params: { id: threadId }, signal }),
      staleTime: 0,
    });
  } catch {
    /* use what we have */
  }
  const last = thread?.messages.at(-1);
  const alreadyStored = s.regenerate || (last?.role === 'user' && last.content.trim() === s.content.trim());
  await sendMessage(qc, threadId, s.content, { regenerate: alreadyStored });
}
