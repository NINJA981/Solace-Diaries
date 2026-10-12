// Owned by the web platform layer. STUB — replaced in Phase 1 (agent C).
//
// Contract for consumers (agent D):
//   import { api, ApiRequestError, streamMessage } from '@/lib/api';
//   api.<routeName>({ params?, query?, body?, headers?, signal? }) → Promise<typed response>
//     route names/types come from `routes` in @solace/shared (e.g. api.listEntries({ query: { limit: 20 } }),
//     api.updateEntry({ params: { id }, body, headers: { 'If-Match': String(version) } })).
//   api.addAttachment({ params: { id }, file, signal? }) → Promise<Attachment>  (multipart upload)
//   streamMessage(threadId, input, { onEvent, signal }) → Promise<void>  (SSE, events = ChatStreamEvent)
//   ApiRequestError: { status, code?, message, fields?, requestId? } — thrown for every non-2xx.
// A 401 anywhere triggers the global sign-out flow; callers don't handle it.
import type { ChatStreamEvent, SendMessageInput } from '@solace/shared';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = new Proxy({}, { get: () => () => Promise.reject(new Error('api stub')) });

export async function streamMessage(
  _threadId: string,
  _input: SendMessageInput,
  _opts: { onEvent: (e: ChatStreamEvent) => void; signal?: AbortSignal },
): Promise<void> {
  throw new Error('stream stub');
}
