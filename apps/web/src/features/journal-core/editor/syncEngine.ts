/**
 * Autosave engine for one entry. Text must never be lost, so the rules are:
 *
 *  - Local first: every edit lands in an IndexedDB draft (debounced ~300ms) before any
 *    network call. The draft is only removed once the server has acknowledged exactly
 *    what is on screen.
 *  - Server sync is debounced (~1.5s) and single-flight: at most one write per entry is in
 *    flight; edits made meanwhile coalesce into one follow-up write of the latest state.
 *  - First write is POST with the client-generated id (idempotent on retry); later writes
 *    are PATCH with `If-Match: <version>` and only the changed fields.
 *  - A POST answered with an already-existing row (`created: false`) is NOT an ack: the row
 *    may hold an older attempt of ours (lost response) or another tab's text (two Today tabs,
 *    a stale device snapshot flushed elsewhere). Same text → ack. The server holds a text
 *    this editor produced earlier (`history`) → rebase and PATCH ours. Otherwise → conflict.
 *  - 409 version_conflict → fetch the server copy. If its title/body equal what we last
 *    synced (e.g. enrichment bumped the version) or an earlier text of ours, rebase onto the
 *    new version and retry.
 *    Otherwise stop and surface a conflict; the user chooses — nothing is dropped silently.
 *  - Offline / 5xx / 429 → keep the draft, back off and retry; flush again on `online`.
 *
 * State machine (status):
 *   empty ──edit──▶ pending ──debounce──▶ saving ──ack──▶ saved
 *                      ▲                    │ ├─network──▶ offline ──online/backoff──▶ saving
 *                      └──────edit──────────┘ ├─5xx/429──▶ retrying ──backoff──▶ saving
 *                                             ├─409 same base──▶ (rebase) saving
 *                                             ├─409 diverged / 404──▶ conflict ──resolve──▶ saving|saved
 *                                             └─400──▶ failed ──edit──▶ pending
 */
import type { CreateEntryInput, Entry, Mood, UpdateEntryInput } from '@solace/shared';

export type { Mood };

export type MoodSource = 'ai' | 'user' | null;

export type EntryFields = {
  title: string;
  body: string;
  entryDate: string;
  mood: Mood | null;
  moodSource: MoodSource;
  tags: string[];
};

export type Draft = {
  id: string;
  fields: EntryFields;
  /** Field values the server last acknowledged; null until the entry exists server-side. */
  synced: EntryFields | null;
  /** Server version for `If-Match`; null until created. */
  version: number | null;
  /** Daily prompt answered by this entry (sent on create only). */
  promptId?: string;
  /**
   * Hashes of title+body versions this editor produced (sent or saved on the device), newest
   * last. A server copy matching one of them is our own ancestor, so it is safe to overwrite.
   */
  history?: string[];
  /** A create was attempted, so the entry may exist server-side even with `version: null`. */
  posted?: boolean;
  /** Epoch ms of the last local edit. */
  updatedAt: number;
};

export type SyncStatus =
  | 'empty' // new entry, nothing typed yet
  | 'pending' // unsaved edits, waiting for the debounce
  | 'saving'
  | 'saved'
  | 'offline' // saved on this device, waiting for a connection
  | 'retrying' // server error, backing off
  | 'conflict' // needs a human decision
  | 'failed'; // rejected (validation); next edit retries

export type Conflict = { kind: 'diverged'; server: Entry } | { kind: 'deleted' };

export type WriteOptions = {
  /** Let the request outlive the page (pagehide flush). The transport decides if it fits. */
  keepalive?: boolean;
};

export interface Transport {
  /** `created: false` means the id already existed and `entry` is the stored row, not ours. */
  create(input: CreateEntryInput, opts?: WriteOptions): Promise<{ entry: Entry; created: boolean }>;
  update(id: string, patch: UpdateEntryInput, version: number, opts?: WriteOptions): Promise<Entry>;
  /** Resolves null on 404. */
  get(id: string): Promise<Entry | null>;
}

export interface DraftStore {
  load(id: string): Promise<Draft | undefined>;
  save(draft: Draft): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<Draft[]>;
}

export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type EngineDeps = {
  transport: Transport;
  store: DraftStore;
  isOnline?: () => boolean;
  /** Called after every acknowledged write (created = first POST). */
  onSaved?: (entry: Entry, created: boolean) => void;
  serverDelayMs?: number;
  localDelayMs?: number;
  retryDelaysMs?: number[];
  timers?: Timers;
  now?: () => number;
};

export type EngineSnapshot = {
  id: string;
  fields: EntryFields;
  status: SyncStatus;
  conflict: Conflict | null;
  error: string | null;
  version: number | null;
  /** True when on-screen fields differ from what the server has. */
  dirty: boolean;
  lastSavedAt: number | null;
};

type ErrorKind = 'conflict' | 'notFound' | 'offline' | 'retryable' | 'fatal';

/** Classify thrown errors by duck-typing `status`/`code` (ApiRequestError-shaped). */
export function classifyError(err: unknown, online: boolean): ErrorKind {
  const e = err as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === undefined) return online ? 'retryable' : 'offline';
  if (status === 409) return 'conflict';
  if (status === 404) return 'notFound';
  if (status === 0) return 'offline';
  if (status === 408 || status === 429 || status >= 500) return 'retryable';
  return 'fatal';
}

export function emptyFields(entryDate: string): EntryFields {
  return { title: '', body: '', entryDate, mood: null, moodSource: null, tags: [] };
}

export function fieldsFromEntry(e: Entry): EntryFields {
  return {
    title: e.title,
    body: e.body,
    entryDate: e.entryDate,
    mood: e.mood,
    moodSource: e.moodSource,
    tags: [...e.tags],
  };
}

export function hasContent(f: EntryFields): boolean {
  return f.title.trim() !== '' || f.body.trim() !== '' || f.mood !== null || f.tags.length > 0;
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** Whether the user's mood choice still needs to reach the server. */
function moodChanged(local: EntryFields, base: EntryFields): boolean {
  if (local.mood !== base.mood) return true;
  // Accepting the AI's suggestion keeps the same mood but flips the source to 'user'.
  return local.moodSource === 'user' && base.moodSource !== 'user';
}

/**
 * Known limitation (accepted): only title/body are conflict-checked. Metadata (mood, tags,
 * entry date) is sent with the same `If-Match`, but a rebase takes the server's metadata for
 * fields untouched locally and resends the rest, and metadata edits don't bump anything we can
 * compare against. So concurrent mood/tag/date edits from two tabs or devices are
 * last-writer-wins.
 */
export function diffFields(local: EntryFields, base: EntryFields): UpdateEntryInput {
  const patch: UpdateEntryInput = {};
  if (local.title !== base.title) patch.title = local.title;
  if (local.body !== base.body) patch.body = local.body;
  if (local.entryDate !== base.entryDate) patch.entryDate = local.entryDate;
  if (moodChanged(local, base)) patch.mood = local.mood;
  if (!sameTags(local.tags, base.tags)) patch.tags = local.tags;
  return patch;
}

export function fieldsEqual(a: EntryFields, b: EntryFields): boolean {
  return Object.keys(diffFields(a, b)).length === 0;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const MAX_REBASES = 3;
const HISTORY_MAX = 50;

function sameText(a: Pick<EntryFields, 'title' | 'body'>, b: Pick<EntryFields, 'title' | 'body'>): boolean {
  return a.title === b.title && a.body === b.body;
}

/** Small non-cryptographic hash (cyrb53) of an entry's title and body. */
export function textHash(f: Pick<EntryFields, 'title' | 'body'>): string {
  const str = `${f.title}\u0000${f.body}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class EntrySync {
  private draft: Draft;
  private status: SyncStatus;
  private conflict: Conflict | null = null;
  private error: string | null = null;
  private lastSavedAt: number | null = null;
  private snapshot!: EngineSnapshot;
  private listeners = new Set<() => void>();

  private inFlight: Promise<void> | null = null;
  private rerun = false;
  private forceCreate = false;
  private keepaliveNext = false;
  /** Our create bumped into an existing row; report "created" to the cache with the next ack. */
  private announceCreated = false;
  private rebases = 0;
  private attempt = 0;
  private serverTimer: unknown = null;
  private localTimer: unknown = null;
  private retryTimer: unknown = null;
  private disposed = false;

  private readonly t: Timers;
  private readonly serverDelay: number;
  private readonly localDelay: number;
  private readonly retryDelays: number[];
  private readonly now: () => number;
  private readonly isOnline: () => boolean;

  constructor(
    initial: Draft,
    private readonly deps: EngineDeps,
  ) {
    this.draft = initial;
    this.t = deps.timers ?? defaultTimers;
    this.serverDelay = deps.serverDelayMs ?? 1500;
    this.localDelay = deps.localDelayMs ?? 300;
    this.retryDelays = deps.retryDelaysMs ?? [2_000, 5_000, 10_000, 30_000, 60_000];
    this.now = deps.now ?? Date.now;
    this.isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.status = this.computeIdleStatus();
    this.refreshSnapshot();
  }

  // ───────── public API ─────────

  get id(): string {
    return this.draft.id;
  }

  getSnapshot = (): EngineSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getDraft(): Draft {
    return this.draft;
  }

  isDirty(): boolean {
    const { fields, synced } = this.draft;
    if (!synced) return hasContent(fields);
    return !fieldsEqual(fields, synced);
  }

  isBusy(): boolean {
    return this.inFlight !== null;
  }

  /** Resolves once the current request (if any) has finished. Never rejects. */
  settle(): Promise<void> {
    return this.inFlight ? this.inFlight.catch(() => undefined) : Promise.resolve();
  }

  /** False only when no create was ever attempted for this entry. */
  mayExistOnServer(): boolean {
    return this.draft.version !== null || this.draft.posted === true;
  }

  /** Apply a local edit. Choosing a mood marks it as the user's own. */
  edit(patch: Partial<EntryFields>): void {
    if (this.disposed) return;
    const next = { ...this.draft.fields, ...patch };
    if ('mood' in patch && !('moodSource' in patch)) next.moodSource = patch.mood ? 'user' : null;
    this.draft = { ...this.draft, fields: next, updatedAt: this.now() };
    if (this.status !== 'conflict') {
      if (this.isDirty()) {
        if (this.status !== 'saving' && this.status !== 'offline' && this.status !== 'retrying') this.status = 'pending';
        this.error = null;
      } else if (this.status !== 'saving') {
        this.status = this.computeIdleStatus();
      }
    }
    this.scheduleLocal();
    this.scheduleServer();
    this.emit();
  }

  setPromptId(promptId: string | undefined): void {
    if (this.draft.version !== null) return; // only meaningful before creation
    this.draft = { ...this.draft, promptId };
    this.scheduleLocal();
  }

  /**
   * Persist locally and sync now (Ctrl+S, blur, visibility change, route change).
   * `keepalive` lets the write outlive the page (pagehide, tab hidden).
   */
  async flush(opts?: WriteOptions): Promise<void> {
    if (opts?.keepalive) this.keepaliveNext = true;
    this.clearTimer('localTimer');
    this.clearTimer('serverTimer');
    await this.persistLocal();
    await this.sync();
  }

  /**
   * The draft as it is right now, if it holds words the server hasn't acknowledged (else
   * null), with its text remembered as our own. Synchronous, for a last-moment rescue when
   * the page is going away and an IndexedDB write may never finish.
   */
  rescueDraft(): Draft | null {
    if (this.disposed || !(this.isDirty() || this.conflict)) return null;
    this.remember(this.draft.fields);
    return this.draft;
  }

  /** Make sure the entry exists server-side (needed before uploading photos). */
  async ensureCreated(): Promise<boolean> {
    if (this.draft.version !== null) return true;
    this.forceCreate = true;
    await this.flush();
    return this.draft.version !== null;
  }

  /** Trigger a sync (coalesced with any write already in flight). */
  sync(): Promise<void> {
    if (this.disposed || this.conflict) return Promise.resolve();
    this.clearTimer('retryTimer');
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    const run = this.loop().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * A fresher server copy arrived (polling for enrichment, another tab). Adopt it when it
   * doesn't clash with local edits; otherwise leave it for the next PATCH to detect.
   */
  adoptServer(entry: Entry): void {
    if (this.disposed || this.inFlight || this.conflict) return;
    const { version, synced, fields } = this.draft;
    if (version !== null && entry.version <= version) return;
    const server = fieldsFromEntry(entry);
    if (!synced) {
      // Created elsewhere (e.g. a background flush) while we still had it as new.
      if (!this.isDirty() || (server.title === fields.title && server.body === fields.body)) {
        this.draft = { ...this.draft, version: entry.version, synced: server, fields: this.mergeMeta(fields, fields, server) };
        this.afterLocalChange();
      }
      return;
    }
    if (fieldsEqual(fields, synced)) {
      this.draft = { ...this.draft, version: entry.version, synced: server, fields: server };
      this.afterLocalChange();
    } else if (server.title === synced.title && server.body === synced.body) {
      this.draft = {
        ...this.draft,
        version: entry.version,
        synced: server,
        fields: this.mergeMeta(fields, synced, server),
      };
      this.afterLocalChange();
    }
  }

  /**
   * Resolve a conflict:
   *  - 'mine'   keep what's on screen and overwrite the server copy (re-create if deleted)
   *  - 'theirs' replace the screen with the server copy and drop the local draft
   */
  async resolveConflict(choice: 'mine' | 'theirs'): Promise<void> {
    const c = this.conflict;
    if (!c) return;
    this.conflict = null;
    this.rebases = 0;
    if (c.kind === 'deleted') {
      if (choice === 'mine') {
        this.draft = { ...this.draft, version: null, synced: null };
        this.forceCreate = true;
        this.status = 'pending';
        this.emit();
        await this.flush();
      } else {
        await this.safeStore(() => this.deps.store.remove(this.draft.id));
        this.draft = { ...this.draft, fields: emptyFields(this.draft.fields.entryDate), synced: null, version: null };
        this.status = 'empty';
        this.emit();
      }
      return;
    }
    const server = fieldsFromEntry(c.server);
    if (choice === 'mine') {
      // Also covers a row our create bumped into (version was null): PATCH over it.
      this.draft = { ...this.draft, version: c.server.version, synced: server };
      this.status = this.isDirty() ? 'pending' : 'saved';
      this.emit();
      await this.flush();
    } else {
      this.draft = { ...this.draft, version: c.server.version, synced: server, fields: server };
      this.status = 'saved';
      this.emit();
      await this.safeStore(() => this.deps.store.remove(this.draft.id));
      if (this.announceCreated) {
        this.announceCreated = false;
        this.deps.onSaved?.(c.server, true);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer('localTimer');
    this.clearTimer('serverTimer');
    this.clearTimer('retryTimer');
    this.listeners.clear();
  }

  // ───────── internals ─────────

  private async loop(): Promise<void> {
    do {
      this.rerun = false;
      const ok = await this.once();
      if (!ok) return;
    } while (this.rerun && !this.disposed);
  }

  /** One write attempt. Resolves false when syncing should stop for now. */
  private async once(): Promise<boolean> {
    const { id, fields, synced, version, promptId } = this.draft;
    if (version === null && !hasContent(fields) && !this.forceCreate) {
      this.setStatus('empty');
      return true;
    }
    if (version !== null && synced && fieldsEqual(fields, synced)) {
      this.setStatus('saved');
      return true;
    }
    if (!this.isOnline()) {
      this.setStatus('offline');
      await this.persistLocal();
      return false;
    }

    this.setStatus('saving');
    const sent = fields;
    const isCreate = version === null;
    const opts: WriteOptions | undefined = this.keepaliveNext ? { keepalive: true } : undefined;
    this.keepaliveNext = false;
    this.remember(sent);
    let entry: Entry;
    let fresh = true;
    try {
      if (isCreate) {
        this.draft = { ...this.draft, posted: true };
        const input: CreateEntryInput = { id, title: sent.title, body: sent.body, entryDate: sent.entryDate };
        if (sent.moodSource === 'user' && sent.mood) input.mood = sent.mood;
        if (sent.tags.length) input.tags = sent.tags;
        if (promptId) input.promptId = promptId;
        const res = await this.deps.transport.create(input, opts);
        entry = res.entry;
        fresh = res.created;
      } else {
        entry = await this.deps.transport.update(id, diffFields(sent, synced!), version, opts);
      }
    } catch (err) {
      return this.handleError(err);
    }
    if (this.disposed) return false;

    this.attempt = 0;
    this.forceCreate = false;
    if (isCreate && !fresh) {
      const verdict = await this.reconcileExisting(entry, sent);
      if (verdict !== 'ack') return verdict === 'rebased';
    }
    this.rebases = 0;
    const created = isCreate || this.announceCreated;
    this.announceCreated = false;
    const server = fieldsFromEntry(entry);
    // If nothing changed while the request was in flight, adopt the server's normalized
    // copy (e.g. lowercased tags) so the next diff is empty.
    const editedMeanwhile = this.draft.fields !== sent;
    this.draft = {
      ...this.draft,
      version: entry.version,
      synced: server,
      fields: editedMeanwhile ? this.mergeMeta(this.draft.fields, sent, server) : this.mergeMeta(sent, sent, server),
    };
    this.lastSavedAt = this.now();
    this.error = null;
    if (this.isDirty()) {
      this.status = 'pending';
      await this.persistLocal();
    } else {
      this.status = 'saved';
      await this.safeStore(() => this.deps.store.remove(id));
    }
    this.emit();
    this.deps.onSaved?.(entry, created);
    return true;
  }

  /**
   * Our POST found the id already taken; `entry` is whatever the server holds. Decide whether
   * that is an ack of what's on screen, our own earlier text (rebase, then PATCH ours with
   * If-Match), or someone else's words (conflict). Never adopts server text over local text.
   */
  private async reconcileExisting(entry: Entry, sent: EntryFields): Promise<'ack' | 'rebased' | 'conflict'> {
    const server = fieldsFromEntry(entry);
    const local = this.draft.fields;
    // e.g. ensureCreated() before a photo upload, with no words typed yet.
    const nothingToLose = !sent.title && !sent.body && !local.title && !local.body;
    if (sameText(server, sent) || sameText(server, local) || nothingToLose) return 'ack';
    this.announceCreated = true;
    if ((this.draft.history ?? []).includes(textHash(server))) {
      // Our own earlier attempt landed (lost response, or a device snapshot another tab flushed).
      this.draft = {
        ...this.draft,
        version: entry.version,
        synced: server,
        fields: { ...this.mergeMeta(local, sent, server), title: local.title, body: local.body },
      };
      this.rerun = true;
      this.afterLocalChange();
      return 'rebased';
    }
    this.conflict = { kind: 'diverged', server: entry };
    this.setStatus('conflict');
    await this.persistLocal();
    return 'conflict';
  }

  /** Record a text version this editor produced (sent, or saved on the device). */
  private remember(f: EntryFields): void {
    const h = textHash(f);
    const history = this.draft.history ?? [];
    if (history[history.length - 1] === h) return;
    this.draft = { ...this.draft, history: [...history.filter((x) => x !== h), h].slice(-HISTORY_MAX) };
  }

  private async handleError(err: unknown): Promise<boolean> {
    if (this.disposed) return false;
    const kind = classifyError(err, this.isOnline());
    if (kind === 'conflict') return this.handleConflict();
    if (kind === 'notFound') {
      if (this.draft.version === null) {
        // POST shouldn't 404; treat as transient.
        return this.backoff('retrying', err);
      }
      this.conflict = { kind: 'deleted' };
      this.setStatus('conflict');
      await this.persistLocal();
      return false;
    }
    if (kind === 'offline') return this.backoff('offline', err);
    if (kind === 'retryable') return this.backoff('retrying', err);
    this.error = (err as Error)?.message || 'The server rejected this entry.';
    this.setStatus('failed');
    await this.persistLocal();
    return false;
  }

  private async handleConflict(): Promise<boolean> {
    let server: Entry | null;
    try {
      server = await this.deps.transport.get(this.draft.id);
    } catch (err) {
      const kind = classifyError(err, this.isOnline());
      return this.backoff(kind === 'offline' ? 'offline' : 'retrying', err);
    }
    if (this.disposed) return false;
    if (!server) {
      this.conflict = { kind: 'deleted' };
      this.setStatus('conflict');
      await this.persistLocal();
      return false;
    }
    const s = fieldsFromEntry(server);
    const { synced, fields } = this.draft;
    const base = synced;
    const sameAsBase = base !== null && sameText(s, base);
    const sameAsMine = sameText(s, fields);
    // A text this editor produced earlier, e.g. a device snapshot another tab flushed first.
    const ownEarlier = (this.draft.history ?? []).includes(textHash(s));
    if ((sameAsBase || sameAsMine || ownEarlier) && this.rebases < MAX_REBASES) {
      this.rebases++;
      const merged = this.mergeMeta(fields, base ?? s, s);
      this.draft = {
        ...this.draft,
        version: server.version,
        synced: s,
        // Never let the rebase pull server text over ours.
        fields: { ...merged, title: fields.title, body: fields.body },
      };
      this.rerun = true;
      return true;
    }
    if (sameAsBase || sameAsMine || ownEarlier) return this.backoff('retrying', new Error('Version kept changing'));
    this.conflict = { kind: 'diverged', server };
    this.setStatus('conflict');
    await this.persistLocal();
    return false;
  }

  /**
   * Take server-side mood/tags/date changes (AI enrichment) for fields the user hasn't
   * touched locally since `base`; keep the user's own title/body.
   */
  private mergeMeta(local: EntryFields, base: EntryFields, server: EntryFields): EntryFields {
    const out = { ...local };
    if (local.title === base.title) out.title = server.title;
    if (local.body === base.body) out.body = server.body;
    if (local.entryDate === base.entryDate) out.entryDate = server.entryDate;
    if (local.mood === base.mood && local.moodSource === base.moodSource) {
      out.mood = server.mood;
      out.moodSource = server.moodSource;
    }
    if (sameTags(local.tags, base.tags)) out.tags = [...server.tags];
    return out;
  }

  private async backoff(status: 'offline' | 'retrying', err: unknown): Promise<boolean> {
    this.error = (err as Error)?.message ?? null;
    this.setStatus(status);
    await this.persistLocal();
    const delay = this.retryDelays[Math.min(this.attempt, this.retryDelays.length - 1)] ?? 60_000;
    this.attempt++;
    this.clearTimer('retryTimer');
    this.retryTimer = this.t.set(() => {
      this.retryTimer = null;
      void this.sync();
    }, delay);
    return false;
  }

  private scheduleLocal(): void {
    this.clearTimer('localTimer');
    this.localTimer = this.t.set(() => {
      this.localTimer = null;
      void this.persistLocal();
    }, this.localDelay);
  }

  private scheduleServer(): void {
    this.clearTimer('serverTimer');
    if (this.conflict) return;
    this.serverTimer = this.t.set(() => {
      this.serverTimer = null;
      void this.sync();
    }, this.serverDelay);
  }

  /** Write the draft to the device store if it holds anything the server doesn't have. */
  private async persistLocal(): Promise<void> {
    this.clearTimer('localTimer');
    if (this.disposed) return;
    if (this.isDirty() || this.conflict) {
      this.remember(this.draft.fields);
      const d = this.draft;
      await this.safeStore(() => this.deps.store.save(d));
    }
  }

  private async safeStore(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // Storage can be unavailable (private mode, quota). Server sync still proceeds.
    }
  }

  private afterLocalChange(): void {
    if (this.status !== 'conflict') this.status = this.isDirty() ? 'pending' : this.computeIdleStatus();
    this.emit();
  }

  private computeIdleStatus(): SyncStatus {
    const { version, fields } = this.draft;
    if (version === null) return hasContent(fields) ? 'pending' : 'empty';
    return this.isDirty() ? 'pending' : 'saved';
  }

  private clearTimer(key: 'localTimer' | 'serverTimer' | 'retryTimer'): void {
    if (this[key] !== null) {
      this.t.clear(this[key]);
      this[key] = null;
    }
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s && s !== 'conflict') return;
    this.status = s;
    this.emit();
  }

  private refreshSnapshot(): void {
    this.snapshot = {
      id: this.draft.id,
      fields: this.draft.fields,
      status: this.status,
      conflict: this.conflict,
      error: this.error,
      version: this.draft.version,
      dirty: this.isDirty(),
      lastSavedAt: this.lastSavedAt,
    };
  }

  private emit(): void {
    this.refreshSnapshot();
    for (const fn of this.listeners) fn();
  }
}
