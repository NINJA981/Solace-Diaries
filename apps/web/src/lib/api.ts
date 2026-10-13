/**
 * Typed API client generated from the shared route table.
 *
 *   api.<routeName>({ params?, query?, body?, headers?, signal? }) → Promise<typed response>
 *     e.g. api.listEntries({ query: { limit: 20 } })
 *          api.updateEntry({ params: { id }, body, headers: { 'If-Match': String(version) } })
 *   api.addAttachment({ params: { id }, file, signal? }) → Promise<Attachment>   (multipart, field `file`)
 *   api.exportMe({ query: { format } }) → downloads the file, resolves with { filename }
 *   streamMessage(threadId, input, { onEvent, signal }) → resolves when the stream ends.
 *     Every event (sources, token, done, error) is delivered through `onEvent`. A stream that
 *     ends without `done`/`error` rejects with ApiRequestError code `stream_interrupted`.
 *     Aborting rejects with the standard `AbortError` DOMException (see `isAbortError`).
 *
 * Every non-2xx response throws `ApiRequestError` { status, code?, message, fields?, requestId? }.
 * `message` is always a human-readable sentence. Network failures use status 0 and code
 * `network_error`; Render cold starts (502-504) use code `unavailable`.
 * A 401 anywhere triggers the global sign-out flow (SessionProvider); callers don't handle it.
 */
import {
  type Attachment,
  type ChatStreamEvent,
  type RouteName,
  type SendMessageInput,
  apiError,
  chatStreamEvent,
  createSseParser,
  routes,
} from '@solace/shared';
import type { z } from 'zod';
import { fireUnauthorized } from './auth-events';
import { ApiRequestError, isAbortError } from './errors';
import { getGeminiKey } from './byok';
import { config } from './config';
import { getSupabase } from './supabase-lazy';

// ───────────────────────── errors ─────────────────────────

export { ApiRequestError, errorMessage, isAbortError, isApiError } from './errors';

const FRIENDLY: Record<number, string> = {
  400: 'That request wasn’t quite right. Check the details and try again.',
  401: 'Your session has ended. Please sign in again.',
  403: 'You don’t have access to that.',
  404: 'We couldn’t find that. It may have been deleted.',
  409: 'This changed somewhere else. Reload to see the latest version.',
  413: 'That’s too large to upload.',
  415: 'That file type isn’t supported.',
  429: 'You’re going a little fast. Wait a moment and try again.',
};
export const WAKING_UP_MESSAGE =
  'Solace is waking up after a quiet spell. This can take up to a minute, so please try again shortly.';
export const OFFLINE_MESSAGE = 'Can’t reach Solace right now. Check your connection and try again.';

function isGateway(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function friendlyFor(status: number): string {
  if (isGateway(status)) return WAKING_UP_MESSAGE;
  return FRIENDLY[status] ?? 'Something went wrong on our side. Please try again.';
}

/** Turns any failed Response into an ApiRequestError, whatever its body looks like. */
export async function toApiError(res: Response): Promise<ApiRequestError> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* body unreadable */
  }
  let parsed: z.infer<typeof apiError> | null = null;
  if (text) {
    try {
      const result = apiError.safeParse(JSON.parse(text));
      if (result.success) parsed = result.data;
    } catch {
      /* not JSON: a proxy error page, cold-start HTML, … */
    }
  }
  const status = res.status;
  // Gateways answer 502-504 with their own pages; our copy is more useful than theirs.
  const gateway = isGateway(status);
  const message = parsed && !gateway ? parsed.error : friendlyFor(status);
  return new ApiRequestError(
    status,
    message,
    parsed?.code ?? (gateway ? 'unavailable' : undefined),
    parsed?.fields,
    parsed?.requestId ?? res.headers.get('x-request-id') ?? undefined,
  );
}

export { setUnauthorizedHandler } from './auth-events';

// ───────────────────────── transport ─────────────────────────

export function apiUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(`${config.apiUrl}/api${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const supabase = await getSupabase();
    // getSession refreshes an expired access token before returning it.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  } catch {
    /* auth unreachable: the API answers 401 and the sign-out flow takes over */
  }
  const key = getGeminiKey();
  if (key) headers['x-gemini-key'] = key;
  return headers;
}

type SendInit = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
};

/** fetch with auth, network-failure mapping and error parsing. Resolves only with ok responses. */
export async function send({ method, url, headers, body, signal }: SendInit): Promise<Response> {
  const auth = await authHeaders();
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { ...auth, ...headers }, body, signal, credentials: 'omit' });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    throw new ApiRequestError(0, OFFLINE_MESSAGE, 'network_error');
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401) fireUnauthorized();
    throw err;
  }
  return res;
}

// ───────────────────────── typed route calls ─────────────────────────

type Routes = typeof routes;
type ResponseKind<N extends RouteName> = Routes[N]['response'];

export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParams<Rest>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;

type ParamsOpt<N extends RouteName> = [PathParams<Routes[N]['path']>] extends [never]
  ? { params?: undefined }
  : { params: Record<PathParams<Routes[N]['path']>, string> };

type QueryOpt<N extends RouteName> = Routes[N] extends { query: infer Q extends z.ZodType }
  ? object extends z.input<Q>
    ? { query?: z.input<Q> }
    : { query: z.input<Q> }
  : { query?: undefined };

type BodyOpt<N extends RouteName> = Routes[N] extends { body: infer B extends z.ZodType }
  ? { body: z.input<B> }
  : { body?: undefined };

export type CallOptions<N extends RouteName> = ParamsOpt<N> &
  QueryOpt<N> &
  BodyOpt<N> & { headers?: Record<string, string>; signal?: AbortSignal };

export type RouteResult<N extends RouteName> =
  ResponseKind<N> extends z.ZodType ? z.output<ResponseKind<N>> : void;

type JsonRoute = {
  [N in RouteName]: ResponseKind<N> extends 'sse' | 'file' ? never : N extends 'addAttachment' ? never : N;
}[RouteName];

type RouteFn<N extends RouteName> = object extends CallOptions<N>
  ? (opts?: CallOptions<N>) => Promise<RouteResult<N>>
  : (opts: CallOptions<N>) => Promise<RouteResult<N>>;

export type Api = { [N in JsonRoute]: RouteFn<N> } & {
  addAttachment(opts: { params: { id: string }; file: Blob; signal?: AbortSignal }): Promise<Attachment>;
  exportMe(opts?: CallOptions<'exportMe'>): Promise<{ filename: string }>;
};

type LooseOpts = {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/** Dev builds validate every response against the contract and log drift loudly. */
function parseResponse(name: string, schema: z.ZodType, data: unknown): unknown {
  if (import.meta.env.PROD) return data;
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.error(`[api] ${name}: response doesn't match the shared contract`, result.error.issues, data);
  return data;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ApiRequestError(res.status, 'The server sent a response we couldn’t read. Please try again.', 'bad_response');
  }
}

async function callRoute(name: RouteName, opts: LooseOpts = {}): Promise<unknown> {
  const route = routes[name];
  const hasBody = opts.body !== undefined;
  const res = await send({
    method: route.method,
    url: apiUrl(fillPath(route.path, opts.params), opts.query),
    headers: {
      accept: 'application/json',
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const response = route.response;
  if (response === null || res.status === 204) return undefined;
  if (typeof response === 'string') return res;
  return parseResponse(name, response, await readJson(res));
}

export function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain?.[1]?.trim() || fallback;
}

/** Saves a blob through a temporary object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function exportMe(opts: LooseOpts = {}): Promise<{ filename: string }> {
  const route = routes.exportMe;
  const res = await send({
    method: route.method,
    url: apiUrl(route.path, opts.query),
    headers: opts.headers,
    signal: opts.signal,
  });
  const format = (opts.query?.format as string | undefined) ?? 'json';
  const day = new Date().toISOString().slice(0, 10);
  const fallback = `solace-export-${day}.${format === 'markdown' ? 'zip' : 'json'}`;
  const filename = filenameFrom(res, fallback);
  saveBlob(await res.blob(), filename);
  return { filename };
}

async function addAttachment(opts: { params: { id: string }; file: Blob; signal?: AbortSignal }): Promise<Attachment> {
  const route = routes.addAttachment;
  const form = new FormData();
  form.append('file', opts.file);
  const res = await send({
    method: route.method,
    url: apiUrl(fillPath(route.path, opts.params)),
    headers: { accept: 'application/json' },
    body: form,
    signal: opts.signal,
  });
  return parseResponse('addAttachment', route.response, await readJson(res)) as Attachment;
}

const special: Record<string, (o: never) => Promise<unknown>> = { addAttachment, exportMe };

export const api: Api = new Proxy({} as Api, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop in special) return special[prop];
    if (!(prop in routes)) return undefined;
    if (routes[prop as RouteName].response === 'sse') {
      return () => Promise.reject(new Error(`Use streamMessage() for ${prop}`));
    }
    return (opts?: LooseOpts) => callRoute(prop as RouteName, opts);
  },
});

// ───────────────────────── chat stream ─────────────────────────

export async function streamMessage(
  threadId: string,
  input: SendMessageInput,
  opts: { onEvent: (e: ChatStreamEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const route = routes.sendMessage;
  const res = await send({
    method: route.method,
    url: apiUrl(fillPath(route.path, { id: threadId })),
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: opts.signal,
  });
  if (!res.body) {
    throw new ApiRequestError(res.status, 'This browser can’t stream answers. Try a recent Chrome, Safari or Firefox.', 'stream_unsupported');
  }
  await readEventStream(res.body, opts.onEvent, opts.signal);
}

const abortError = () => new DOMException('The answer was stopped.', 'AbortError');

/** Reads an SSE body, validating each event against the shared `chatStreamEvent` schema. */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  let finished = false;
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const handle = (text: string) => {
    for (const raw of parse(text)) {
      if (finished) return;
      let data: unknown;
      try {
        data = JSON.parse(raw.data);
      } catch {
        continue;
      }
      const result = chatStreamEvent.safeParse({ event: raw.event, data });
      if (!result.success) {
        if (!import.meta.env.PROD) console.warn('[api] ignored malformed stream event', raw);
        continue;
      }
      if (result.data.event === 'done' || result.data.event === 'error') finished = true;
      onEvent(result.data);
    }
  };

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal?.aborted) throw abortError();
        if (finished) return;
        throw new ApiRequestError(0, 'The connection dropped before the answer finished. Please try again.', 'stream_interrupted');
      }
      if (signal?.aborted) throw abortError();
      if (chunk.done) break;
      handle(decoder.decode(chunk.value, { stream: true }));
      if (finished) {
        reader.cancel().catch(() => {});
        return;
      }
    }
    // Flush a final event that arrived without its trailing blank line.
    handle(`${decoder.decode()}\n\n`);
    if (!finished) {
      throw new ApiRequestError(0, 'The answer was cut off before it finished. Please try again.', 'stream_interrupted');
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
