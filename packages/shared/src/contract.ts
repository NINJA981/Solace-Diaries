/**
 * The Solace API contract. Every request/response body crossing the wire is defined here
 * once and validated on both sides: the API parses inputs with these schemas, the web
 * client types its calls from the inferred types.
 *
 * Conventions
 * - All routes live under `/api`. Auth: `Authorization: Bearer <supabase access token>`.
 * - Errors: non-2xx with body `ApiError`.
 * - Dates: `YYYY-MM-DD` strings are *local calendar dates* in the user's timezone;
 *   timestamps are ISO-8601 UTC strings.
 * - Optional bring-your-own Gemini key: header `x-gemini-key` (never logged, never stored).
 */
import { z } from 'zod';

// ───────────────────────── primitives ─────────────────────────

export const LIMITS = {
  titleMax: 200,
  bodyMax: 50_000,
  tagsMax: 12,
  tagMax: 40,
  attachmentsPerEntry: 6,
  attachmentBytes: 8 * 1024 * 1024,
  chatMessageMax: 2_000,
  searchQueryMax: 300,
  memoryContentMax: 500,
  displayNameMax: 60,
  pageSizeMax: 50,
} as const;

/** True for a real calendar date (no 2024-02-31, no month 13, no year 0, which Postgres lacks). */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (y < 1) return false;
  // Round-trip through a UTC date: impossible days/months roll over and no longer match.
  // setUTCFullYear (unlike Date.UTC's year argument) treats years 0-99 literally.
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(isRealDate, 'Not a real calendar date');
export const timestamp = z.string().datetime({ offset: true });
export const uuid = z.string().uuid();
/** IANA timezone, validated server-side with Intl. */
export const timezone = z.string().min(1).max(64);

export const MOODS = [
  'joyful',
  'grateful',
  'calm',
  'hopeful',
  'reflective',
  'tired',
  'anxious',
  'sad',
  'frustrated',
  'overwhelmed',
] as const;
export const mood = z.enum(MOODS);
export type Mood = z.infer<typeof mood>;

/** Valence used for charts: -2 (very low) … +2 (very high). */
export const MOOD_SCORE: Record<Mood, number> = {
  joyful: 2,
  grateful: 2,
  hopeful: 1,
  calm: 1,
  reflective: 0,
  tired: -1,
  anxious: -1,
  frustrated: -1,
  sad: -2,
  overwhelmed: -2,
};

export const enrichmentStatus = z.enum(['pending', 'processing', 'ready', 'failed']);
export type EnrichmentStatus = z.infer<typeof enrichmentStatus>;

export const apiError = z.object({
  error: z.string(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  /** Field-level validation messages, keyed by dotted path. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof apiError>;

export const ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  validation: 'validation_failed',
  versionConflict: 'version_conflict',
  rateLimited: 'rate_limited',
  quotaExceeded: 'ai_quota_exceeded',
  aiUnavailable: 'ai_unavailable',
  internal: 'internal_error',
} as const;

export const cursorPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

// ───────────────────────── profile ─────────────────────────

export const aiStyle = z.enum(['gentle', 'direct', 'curious', 'stoic']);
export type AiStyle = z.infer<typeof aiStyle>;

/** Theme worlds: whole looks (type, colour, shape, motion, sound, voice). Anyone may pick any. */
export const WORLDS = ['lamplight', 'jelly', 'scrapbook', 'chrome'] as const;
export const world = z.enum(WORLDS);
export type World = z.infer<typeof world>;

/** Adult (18+) or teen (13–17, needs parental consent); under-13s can't have an account. */
export const accountMode = z.enum(['adult', 'teen']);
export type AccountMode = z.infer<typeof accountMode>;
export const consentStatus = z.enum(['not_required', 'pending', 'granted', 'revoked']);
export type ConsentStatus = z.infer<typeof consentStatus>;

export const profile = z.object({
  id: uuid,
  email: z.string().email(),
  displayName: z.string(),
  timezone,
  onboardingDone: z.boolean(),
  aiStyle,
  /** Local hour 0-23 for a gentle in-app reminder, or null when off. */
  reminderHour: z.number().int().min(0).max(23).nullable(),
  world,
  /** UI sounds and haptics are opt-in. */
  soundEnabled: z.boolean(),
  hapticsEnabled: z.boolean(),
  /** The companion's name; empty means the world's default name. */
  companionName: z.string(),
  mode: accountMode,
  /** False until the person has confirmed their age (required before using the app). */
  ageConfirmed: z.boolean(),
  consentStatus,
  /** When a parent last decided (granted, declined or revoked); null/absent if never. */
  consentDecidedAt: timestamp.nullable().optional(),
  createdAt: timestamp,
});
export type Profile = z.infer<typeof profile>;

export const updateProfileInput = z
  .object({
    displayName: z.string().trim().min(1).max(LIMITS.displayNameMax),
    timezone,
    onboardingDone: z.boolean(),
    aiStyle,
    reminderHour: z.number().int().min(0).max(23).nullable(),
    world,
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    companionName: z.string().trim().max(24),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

// ───────────────────────── entries ─────────────────────────

export const attachment = z.object({
  id: uuid,
  entryId: uuid,
  mime: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  description: z.string().nullable(),
  /** Short-lived signed URL (≈1h). Re-fetch the entry to refresh. */
  url: z.string().url(),
  createdAt: timestamp,
});
export type Attachment = z.infer<typeof attachment>;

export const entry = z.object({
  id: uuid,
  title: z.string(),
  body: z.string(),
  entryDate: isoDate,
  mood: mood.nullable(),
  moodSource: z.enum(['ai', 'user']).nullable(),
  tags: z.array(z.string()),
  /** One-sentence AI summary, null until enrichment completes. */
  summary: z.string().nullable(),
  wordCount: z.number().int(),
  /** Monotonic; send back in `If-Match` when patching. */
  version: z.number().int(),
  enrichmentStatus,
  attachments: z.array(attachment),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Entry = z.infer<typeof entry>;

/** Lightweight list item (no body, no attachment URLs). */
export const entrySummary = entry
  .omit({ body: true, attachments: true })
  .extend({ excerpt: z.string(), attachmentCount: z.number().int() });
export type EntrySummary = z.infer<typeof entrySummary>;

const tagList = z
  .array(z.string().trim().toLowerCase().min(1).max(LIMITS.tagMax))
  .max(LIMITS.tagsMax);

export const createEntryInput = z.object({
  /** Client-generated id so offline-created drafts are idempotent on retry. */
  id: uuid.optional(),
  title: z.string().max(LIMITS.titleMax).default(''),
  body: z.string().max(LIMITS.bodyMax).default(''),
  entryDate: isoDate.optional(),
  mood: mood.nullable().optional(),
  tags: tagList.optional(),
  /** Daily prompt this entry answers, if any. */
  promptId: uuid.optional(),
});
export type CreateEntryInput = z.infer<typeof createEntryInput>;

/** PATCH /entries/:id — requires header `If-Match: <version>`; 409 `version_conflict` on mismatch. */
export const updateEntryInput = z
  .object({
    title: z.string().max(LIMITS.titleMax),
    body: z.string().max(LIMITS.bodyMax),
    entryDate: isoDate,
    /** Setting mood marks moodSource='user' and AI will not overwrite it. null clears. */
    mood: mood.nullable(),
    tags: tagList,
  })
  .partial();
export type UpdateEntryInput = z.infer<typeof updateEntryInput>;

export const listEntriesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mood: mood.optional(),
  tag: z.string().optional(),
});
export type ListEntriesQuery = z.infer<typeof listEntriesQuery>;

export const entryPage = cursorPage(entrySummary);
export type EntryPage = z.infer<typeof entryPage>;

// ───────────────────────── search ─────────────────────────

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(LIMITS.searchQueryMax),
  /** hybrid = meaning + keywords (default); keyword = exact words only. */
  mode: z.enum(['hybrid', 'keyword']).default('hybrid'),
  mood: mood.optional(),
  tag: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
export type SearchQuery = z.infer<typeof searchQuery>;

export const searchHit = z.object({
  entry: entrySummary,
  /** Best-matching passage with the query terms; plain text. */
  snippet: z.string(),
  score: z.number(),
  matchedBy: z.array(z.enum(['meaning', 'keyword'])),
});
export const searchResult = z.object({
  hits: z.array(searchHit),
  mode: z.enum(['hybrid', 'keyword']),
});
export type SearchHit = z.infer<typeof searchHit>;
export type SearchResult = z.infer<typeof searchResult>;

// ───────────────────────── reflect (chat) ─────────────────────────

export const citation = z.object({
  /** 1-based marker the model uses inline, e.g. [1]. */
  n: z.number().int(),
  entryId: uuid,
  title: z.string(),
  entryDate: isoDate,
  snippet: z.string(),
});
export type Citation = z.infer<typeof citation>;

export const chatMessage = z.object({
  id: uuid,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(citation),
  createdAt: timestamp,
});
export type ChatMessage = z.infer<typeof chatMessage>;

/** Guided reflection scripts; 'open' is a free conversation. */
export const THREAD_MODES = ['open', 'gratitude', 'reframe', 'unsent_letter', 'sunday_review'] as const;
export const threadMode = z.enum(THREAD_MODES);
export type ThreadMode = z.infer<typeof threadMode>;

export const thread = z.object({
  id: uuid,
  mode: threadMode.optional(),
  title: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Thread = z.infer<typeof thread>;

export const threadWithMessages = thread.extend({ messages: z.array(chatMessage) });
export type ThreadWithMessages = z.infer<typeof threadWithMessages>;

export const threadList = z.object({ items: z.array(thread) });

export const createThreadInput = z.object({
  title: z.string().trim().max(120).optional(),
  mode: threadMode.optional(),
});

export const sendMessageInput = z.object({
  content: z.string().trim().min(1).max(LIMITS.chatMessageMax),
  /** Re-generate the last assistant answer instead of appending a new user message. */
  regenerate: z.boolean().optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInput>;

/**
 * POST /threads/:id/messages responds with `text/event-stream`. Events, in order:
 *   event: sources  data: { citations: Citation[] }
 *   event: token    data: { text: string }            (repeated)
 *   event: done     data: { message: ChatMessage, userMessage: ChatMessage | null }
 *   event: error    data: ApiError                     (terminal, instead of done)
 */
export const chatStreamEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('sources'), data: z.object({ citations: z.array(citation) }) }),
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }) }),
  z.object({
    event: z.literal('done'),
    data: z.object({ message: chatMessage, userMessage: chatMessage.nullable() }),
  }),
  z.object({ event: z.literal('error'), data: apiError }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEvent>;

// ───────────────────────── insights ─────────────────────────

export const statsQuery = z.object({ tz: timezone.optional() });

export const dayStat = z.object({
  date: isoDate,
  count: z.number().int(),
  words: z.number().int(),
  /** Average valence of the day's moods, null if none. */
  moodScore: z.number().nullable(),
  /** Most frequent mood that day. */
  mood: mood.nullable(),
});
export type DayStat = z.infer<typeof dayStat>;

export const weekMood = z.object({
  weekStart: isoDate,
  avgScore: z.number().nullable(),
  counts: z.record(z.string(), z.number().int()),
});
export type WeekMood = z.infer<typeof weekMood>;

export const stats = z.object({
  /** Today in the user's timezone. */
  today: isoDate,
  /** Last 365 days, oldest first, only days with entries. */
  days: z.array(dayStat),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  totalEntries: z.number().int(),
  totalWords: z.number().int(),
  /** Last 26 weeks, oldest first (Monday-start weeks). */
  moodTrend: z.array(weekMood),
  topTags: z.array(z.object({ tag: z.string(), count: z.number().int() })),
});
export type Stats = z.infer<typeof stats>;

export const weeklyLetter = z.object({
  weekStart: isoDate,
  /** Markdown; rendered with SafeMarkdown (no images/HTML). */
  content: z.string(),
  entryCount: z.number().int(),
  generatedAt: timestamp,
  /** True when new entries exist since generation and a refresh would change it. */
  stale: z.boolean(),
});
export type WeeklyLetter = z.infer<typeof weeklyLetter>;

/** GET /insights/weekly → { letter: WeeklyLetter | null } (null when too few entries). */
export const weeklyLetterResponse = z.object({
  letter: weeklyLetter.nullable(),
  minEntries: z.number().int(),
});
export type WeeklyLetterResponse = z.infer<typeof weeklyLetterResponse>;

// ───────────────────────── memories ─────────────────────────

export const MEMORY_KINDS = [
  'person',
  'place',
  'goal',
  'habit',
  'pattern',
  'fact',
  'feeling',
] as const;
export const memoryKind = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof memoryKind>;

export const memory = z.object({
  id: uuid,
  kind: memoryKind,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'archived']),
  sourceEntryIds: z.array(uuid),
  firstSeen: timestamp,
  lastSeen: timestamp,
});
export type Memory = z.infer<typeof memory>;

export const listMemoriesQuery = z.object({
  status: z.enum(['active', 'archived']).default('active'),
  kind: memoryKind.optional(),
});

export const memoryList = z.object({ items: z.array(memory) });

export const updateMemoryInput = z
  .object({
    content: z.string().trim().min(1).max(LIMITS.memoryContentMax),
    kind: memoryKind,
    status: z.enum(['active', 'archived']),
  })
  .partial();
export type UpdateMemoryInput = z.infer<typeof updateMemoryInput>;

export const GRAPH_KINDS = ['person', 'place', 'project', 'goal', 'habit', 'emotion'] as const;
export const graphKind = z.enum(GRAPH_KINDS);
export type GraphKind = z.infer<typeof graphKind>;

export const graph = z.object({
  nodes: z.array(z.object({ id: uuid, name: z.string(), kind: graphKind, weight: z.number() })),
  edges: z.array(z.object({ source: uuid, target: uuid, weight: z.number() })),
});
export type Graph = z.infer<typeof graph>;

// ───────────────────────── prompts ─────────────────────────

export const dailyPrompt = z.object({
  id: uuid,
  text: z.string(),
  source: z.enum(['curated', 'memory']),
  forDate: isoDate,
  status: z.enum(['pending', 'answered', 'dismissed']),
  entryId: uuid.nullable(),
});
export type DailyPrompt = z.infer<typeof dailyPrompt>;

/** GET /prompts/today?tz= → { prompt } (null only if dismissed today). */
export const todayPromptResponse = z.object({ prompt: dailyPrompt.nullable() });

// ───────────────────────── account ─────────────────────────

export const exportQuery = z.object({ format: z.enum(['json', 'markdown']).default('json') });

/** DELETE /me requires the user to type their email to confirm. */
export const deleteAccountInput = z.object({ confirmEmail: z.string().email() });

export const health = z.object({ ok: z.boolean(), db: z.boolean(), version: z.string() });
