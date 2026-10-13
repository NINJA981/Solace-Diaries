/**
 * Route table: the one place that pairs each endpoint with its schemas. The API mounts
 * handlers under these paths; the web client builds typed calls from them.
 * Paths are relative to `/api`.
 */
import type { z } from 'zod';
import * as c from './contract';
import * as u from './usage';
import * as v from './v3';

type Def = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  /** Response schema; `null` = 204 No Content; 'sse' = event stream; 'file' = download. */
  response: z.ZodTypeAny | null | 'sse' | 'file';
};

export const routes = {
  health: { method: 'GET', path: '/healthz', response: c.health },

  getMe: { method: 'GET', path: '/me', response: c.profile },
  getUsage: { method: 'GET', path: '/me/usage', response: u.aiUsage },
  updateMe: { method: 'PATCH', path: '/me', body: c.updateProfileInput, response: c.profile },
  exportMe: { method: 'GET', path: '/me/export', query: c.exportQuery, response: 'file' },
  deleteMe: { method: 'DELETE', path: '/me', body: c.deleteAccountInput, response: null },

  listEntries: { method: 'GET', path: '/entries', query: c.listEntriesQuery, response: c.entryPage },
  getEntry: { method: 'GET', path: '/entries/:id', response: c.entry },
  createEntry: { method: 'POST', path: '/entries', body: c.createEntryInput, response: c.entry },
  /** Requires `If-Match: <version>`. */
  updateEntry: { method: 'PATCH', path: '/entries/:id', body: c.updateEntryInput, response: c.entry },
  deleteEntry: { method: 'DELETE', path: '/entries/:id', response: null },
  /** multipart/form-data, field `file` (one image per request). */
  addAttachment: { method: 'POST', path: '/entries/:id/attachments', response: c.attachment },
  deleteAttachment: { method: 'DELETE', path: '/entries/:id/attachments/:attachmentId', response: null },
  /** Re-queue enrichment for an entry whose enrichmentStatus is 'failed'. */
  retryEnrichment: { method: 'POST', path: '/entries/:id/enrich', response: c.entry },

  search: { method: 'GET', path: '/search', query: c.searchQuery, response: c.searchResult },

  listThreads: { method: 'GET', path: '/threads', response: c.threadList },
  createThread: { method: 'POST', path: '/threads', body: c.createThreadInput, response: c.thread },
  getThread: { method: 'GET', path: '/threads/:id', response: c.threadWithMessages },
  deleteThread: { method: 'DELETE', path: '/threads/:id', response: null },
  sendMessage: { method: 'POST', path: '/threads/:id/messages', body: c.sendMessageInput, response: 'sse' },

  stats: { method: 'GET', path: '/insights/stats', query: c.statsQuery, response: c.stats },
  weekly: { method: 'GET', path: '/insights/weekly', query: c.statsQuery, response: c.weeklyLetterResponse },
  refreshWeekly: { method: 'POST', path: '/insights/weekly/refresh', query: c.statsQuery, response: c.weeklyLetterResponse },

  listMemories: { method: 'GET', path: '/memories', query: c.listMemoriesQuery, response: c.memoryList },
  updateMemory: { method: 'PATCH', path: '/memories/:id', body: c.updateMemoryInput, response: c.memory },
  deleteMemory: { method: 'DELETE', path: '/memories/:id', response: null },
  graph: { method: 'GET', path: '/memories/graph', response: c.graph },

  todayPrompt: { method: 'GET', path: '/prompts/today', query: c.statsQuery, response: c.todayPromptResponse },
  dismissPrompt: { method: 'POST', path: '/prompts/:id/dismiss', response: c.dailyPrompt },

  // ── v3: time & memory ──
  listCapsules: { method: 'GET', path: '/capsules', response: v.capsuleList },
  createCapsule: { method: 'POST', path: '/capsules', body: v.createCapsuleInput, response: v.capsule },
  /** Only works once unlockAt has passed; returns the opened capsule with its body. */
  openCapsule: { method: 'POST', path: '/capsules/:id/open', response: v.capsule },
  deleteCapsule: { method: 'DELETE', path: '/capsules/:id', response: null },
  resurface: { method: 'GET', path: '/resurface', query: c.statsQuery, response: v.resurfaceResponse },
  unwrapped: { method: 'GET', path: '/unwrapped', query: v.unwrappedQuery, response: v.unwrapped },

  // ── v3: AI magic (budget-aware) ──
  listLetters: { method: 'GET', path: '/letters', response: v.pastLetterList },
  /** Writes this month's letter from your past self (idempotent per month; spends AI budget). */
  writeLetter: { method: 'POST', path: '/letters', query: c.statsQuery, response: v.pastLetter },
  replyToLetter: { method: 'POST', path: '/letters/:id/reply', body: v.replyToLetterInput, response: c.entry },
  listChapters: { method: 'GET', path: '/chapters', response: v.chapterList },
  /** Queues a chapter refresh (batch job); returns the current list immediately. */
  refreshChapters: { method: 'POST', path: '/chapters/refresh', response: v.chapterList },
  listGrowthNotes: { method: 'GET', path: '/growth', response: v.growthNoteList },

  // ── v3: habits & growth ──
  listIntentions: { method: 'GET', path: '/intentions', response: v.intentionList },
  intentionSuggestions: { method: 'GET', path: '/intentions/suggestions', response: v.intentionSuggestions },
  createIntention: { method: 'POST', path: '/intentions', body: v.createIntentionInput, response: v.intention },
  updateIntention: { method: 'PATCH', path: '/intentions/:id', body: v.updateIntentionInput, response: v.intention },
  deleteIntention: { method: 'DELETE', path: '/intentions/:id', response: null },
  checkIn: { method: 'POST', path: '/intentions/:id/checkins', body: v.checkinInput, response: v.intention },
  undoCheckIn: { method: 'DELETE', path: '/intentions/:id/checkins/:date', response: v.intention },
  weeklyRitual: { method: 'POST', path: '/rituals/weekly', body: v.weeklyRitualInput, response: v.weeklyRitualResult },
  companion: { method: 'GET', path: '/companion', query: c.statsQuery, response: v.companionResponse },
  correlations: { method: 'GET', path: '/insights/correlations', query: c.statsQuery, response: v.correlationList },

  // ── v3: teen mode ──
  /** Age gate: sets the age band and mode; 403 `age_restricted` under 13. */
  confirmAge: { method: 'POST', path: '/me/age', body: v.ageCheckInput, response: c.profile },
  requestConsent: { method: 'POST', path: '/me/consent', body: v.consentRequestInput, response: v.consentRequestResult },
  /** Public (no auth): the parent's consent page. */
  viewConsent: { method: 'GET', path: '/consent/:token', response: v.consentView },
  decideConsent: { method: 'POST', path: '/consent/:token', body: v.consentDecisionInput, response: v.consentView },
} as const satisfies Record<string, Def>;

export type RouteName = keyof typeof routes;
