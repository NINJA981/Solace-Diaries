/**
 * Database schema (Drizzle). Every user-owned row carries `user_id` and every query must
 * filter on it — the API connects as the table owner, so RLS (enabled deny-all on every
 * table) only shields the data from Supabase's public Data API, not from our own code.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type { Citation } from '@solace/shared';

export const EMBEDDING_DIMS = 768;

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ───────────────────────── users ─────────────────────────

/** One row per Supabase auth user (id = auth.users.id). Created lazily on first API call. */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  timezone: text('timezone').notNull().default('UTC'),
  onboardingDone: boolean('onboarding_done').notNull().default(false),
  aiStyle: text('ai_style', { enum: ['gentle', 'direct', 'curious', 'stoic'] })
    .notNull()
    .default('gentle'),
  reminderHour: smallint('reminder_hour'),
  world: text('world', { enum: ['lamplight', 'jelly', 'scrapbook', 'chrome'] })
    .notNull()
    .default('lamplight'),
  soundEnabled: boolean('sound_enabled').notNull().default(false),
  hapticsEnabled: boolean('haptics_enabled').notNull().default(false),
  companionName: text('companion_name').notNull().default(''),
  mode: text('mode', { enum: ['adult', 'teen'] })
    .notNull()
    .default('adult'),
  /** '13-15' | '16-17' | '18+'; null until the age gate is answered. Never store a birth date. */
  ageBand: text('age_band', { enum: ['13-15', '16-17', '18+'] }),
  consentStatus: text('consent_status', { enum: ['not_required', 'pending', 'granted', 'revoked'] })
    .notNull()
    .default('not_required'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

// ───────────────────────── journal ─────────────────────────

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    /** Local calendar date in the user's timezone at creation (editable). */
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    mood: text('mood'),
    moodSource: text('mood_source', { enum: ['ai', 'user'] }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    summary: text('summary'),
    wordCount: integer('word_count').notNull().default(0),
    /** Bumped on every content write; used for optimistic concurrency (If-Match). */
    version: integer('version').notNull().default(1),
    /** The version the current chunks/analysis were computed from. */
    enrichedVersion: integer('enriched_version'),
    enrichmentStatus: text('enrichment_status', {
      enum: ['pending', 'processing', 'ready', 'failed'],
    })
      .notNull()
      .default('pending'),
    /** Concatenated photo descriptions, kept here so the generated tsvector can index them. */
    attachmentText: text('attachment_text').notNull().default(''),
    promptId: uuid('prompt_id'),
    /** A wordless entry: chosen colour, texture and optional doodle (SVG path data), or null. */
    wordless: jsonb('wordless').$type<{ color: string; texture: string; doodle?: string } | null>(),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B') || setweight(to_tsvector('english', coalesce(attachment_text, '')), 'C')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('entries_user_date_idx').on(t.userId, t.entryDate.desc(), t.createdAt.desc()),
    index('entries_search_idx').using('gin', t.search),
    index('entries_tags_idx').using('gin', t.tags),
  ],
).enableRLS();

export const entryChunks = pgTable(
  'entry_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }).notNull(),
    /** Embedding model that produced the vector — never mix vector spaces. */
    model: text('model').notNull(),
    entryVersion: integer('entry_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('entry_chunks_entry_idx_uq').on(t.entryId, t.idx),
    index('entry_chunks_user_idx').on(t.userId),
    index('entry_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
).enableRLS();

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Object path in the private bucket: `${userId}/${entryId}/${id}.${ext}`. */
    storagePath: text('storage_path').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull(),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_entry_idx').on(t.entryId), index('attachments_user_idx').on(t.userId)],
).enableRLS();

// ───────────────────────── memory ─────────────────────────

/** Unified long-term memory: durable facts/patterns Solace has learned, user-editable. */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['person', 'place', 'goal', 'habit', 'pattern', 'fact', 'feeling'],
    }).notNull(),
    content: text('content').notNull(),
    confidence: real('confidence').notNull().default(0.6),
    /** Reinforcement count — how many entries support this memory. */
    salience: integer('salience').notNull().default(1),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    /** True once the user edited it; AI must not overwrite user-edited memories. */
    userEdited: boolean('user_edited').notNull().default(false),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }),
    model: text('model'),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('memories_user_status_idx').on(t.userId, t.status),
    index('memories_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
).enableRLS();

export const memorySources = pgTable(
  'memory_sources',
  {
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.entryId] }), index('memory_sources_entry_idx').on(t.entryId)],
).enableRLS();

export const graphNodes = pgTable(
  'graph_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Lower-cased, trimmed name used for de-duplication. */
    key: text('key').notNull(),
    kind: text('kind', {
      enum: ['person', 'place', 'project', 'goal', 'habit', 'emotion'],
    }).notNull(),
    weight: real('weight').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('graph_nodes_user_key_kind_uq').on(t.userId, t.key, t.kind)],
).enableRLS();

export const graphEdges = pgTable(
  'graph_edges',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Undirected edge stored with source < target (uuid ordering). */
    source: uuid('source')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    target: uuid('target')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    weight: real('weight').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.source, t.target] }), index('graph_edges_user_idx').on(t.userId)],
).enableRLS();

/** Which entries contributed which graph nodes — makes re-extraction idempotent. */
export const graphNodeSources = pgTable(
  'graph_node_sources',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.entryId] }), index('graph_node_sources_entry_idx').on(t.entryId)],
).enableRLS();

// ───────────────────────── reflect ─────────────────────────

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New reflection'),
    /** Guided reflection script for this thread; 'open' is a free conversation. */
    mode: text('mode', { enum: ['open', 'gratitude', 'reframe', 'unsent_letter', 'sunday_review'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chat_threads_user_idx').on(t.userId, t.updatedAt.desc())],
).enableRLS();

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_thread_idx').on(t.threadId, t.createdAt)],
).enableRLS();

// ───────────────────────── prompts & insights ─────────────────────────

export const prompts = pgTable(
  'prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    source: text('source', { enum: ['curated', 'memory'] }).notNull(),
    forDate: date('for_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['pending', 'answered', 'dismissed'] })
      .notNull()
      .default('pending'),
    entryId: uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    memoryId: uuid('memory_id').references(() => memories.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('prompts_user_date_uq').on(t.userId, t.forDate)],
).enableRLS();

export const insightReports = pgTable(
  'insight_reports',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    content: text('content').notNull(),
    entryCount: integer('entry_count').notNull(),
    /** Latest entry updated_at included, to detect staleness. */
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
).enableRLS();

// ───────────────────────── infrastructure ─────────────────────────

/** Durable background jobs, claimed with FOR UPDATE SKIP LOCKED. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Coalesces duplicates: at most one queued/running job per key. */
    dedupeKey: text('dedupe_key'),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'dead'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(6),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_ready_idx').on(t.status, t.runAfter),
    uniqueIndex('jobs_dedupe_active_uq')
      .on(t.dedupeKey)
      .where(sql`status in ('queued', 'running') and dedupe_key is not null`),
  ],
).enableRLS();

/** Per-user daily AI usage when running on the server's Gemini key. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    /** Interactive calls (search, Reflect, insights), capped by AI_DAILY_QUOTA. */
    calls: integer('calls').notNull().default(0),
    /** Background enrichment runs, capped separately by ENRICH_DAILY_QUOTA. */
    enrichRuns: integer('enrich_runs').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
).enableRLS();

// ───────────────────────── v3: time & memory ─────────────────────────

/** Letters to future you, sealed until unlock_at. The body never leaves the server while sealed. */
export const capsules = pgTable(
  'capsules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    unlockAt: timestamp('unlock_at', { withTimezone: true }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('capsules_user_unlock_idx').on(t.userId, t.unlockAt)],
).enableRLS();

// ───────────────────────── v3: AI magic ─────────────────────────

/** Monthly letters written in the person's own voice from older entries. */
export const pastLetters = pgTable(
  'past_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** YYYY-MM the letter was written for; one per month. */
    month: text('month').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default(sql`'[]'::jsonb`),
    replyEntryId: uuid('reply_entry_id').references(() => entries.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('past_letters_user_month_uq').on(t.userId, t.month)],
).enableRLS();

/** Named eras of a life, detected from entry summaries by a batch job. */
export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),
    /** Theme colour role: mood-1..mood-5, accent or ai. */
    color: text('color').notNull(),
    cast: text('cast').array().notNull().default(sql`'{}'::text[]`),
    keyEntryIds: uuid('key_entry_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** Latest entry updated_at the chapters were built from, to detect staleness. */
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('chapters_user_from_idx').on(t.userId, t.fromDate)],
).enableRLS();

/** Weekly, cited observations of change ("In March you wrote X; lately Y"). */
export const growthNotes = pgTable(
  'growth_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    text: text('text').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('growth_notes_user_week_idx').on(t.userId, t.weekStart)],
).enableRLS();

// ───────────────────────── v3: habits & growth ─────────────────────────

export const intentions = pgTable(
  'intentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['habit', 'goal'] }).notNull(),
    cadence: text('cadence', { enum: ['daily', 'weekly', 'none'] })
      .notNull()
      .default('none'),
    status: text('status', { enum: ['active', 'paused', 'done'] })
      .notNull()
      .default('active'),
    source: text('source', { enum: ['user', 'detected'] })
      .notNull()
      .default('user'),
    memoryId: uuid('memory_id').references(() => memories.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('intentions_user_status_idx').on(t.userId, t.status)],
).enableRLS();

export const intentionCheckins = pgTable(
  'intention_checkins',
  {
    intentionId: uuid('intention_id')
      .notNull()
      .references(() => intentions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.intentionId, t.date] }),
    index('intention_checkins_user_idx').on(t.userId),
  ],
).enableRLS();

// ───────────────────────── v3: teen mode ─────────────────────────

/**
 * Parental consent for 13–17 accounts. Stores hashes only: the parent's email and the
 * one-time link token are never kept in clear text.
 */
export const parentalConsents = pgTable(
  'parental_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    parentEmailHash: text('parent_email_hash').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status', { enum: ['pending', 'granted', 'denied', 'revoked'] })
      .notNull()
      .default('pending'),
    policyVersion: text('policy_version').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('parental_consents_token_uq').on(t.tokenHash),
    index('parental_consents_user_idx').on(t.userId),
  ],
).enableRLS();
