/**
 * Route table: the one place that pairs each endpoint with its schemas. The API mounts
 * handlers under these paths; the web client builds typed calls from them.
 * Paths are relative to `/api`.
 */
import type { z } from 'zod';
import * as c from './contract';

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
} as const satisfies Record<string, Def>;

export type RouteName = keyof typeof routes;
