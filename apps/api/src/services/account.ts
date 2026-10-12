/** Data ownership: full export (JSON / Markdown) and account deletion. */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Entry } from '@solace/shared';
import { isTest } from '../config';
import { db } from '../db/client';
import { chatMessages, chatThreads, jobs, memories, memorySources, profiles } from '../db/schema';
import { deleteAuthUser } from '../auth/supabase-admin';
import { badRequest } from '../http/errors';
import type { AuthContext } from '../http/types';
import { deletePrefix } from '../storage';
import { entryPages } from './entries';
import { forgetProfile, getProfile, toProfile } from './profiles';

const THREAD_PAGE = 50;

// ── JSON export ────────────────────────────────────────────────────────

/** Streams the export as JSON text chunks, a page at a time, so memory stays flat. */
export async function* exportJson(userId: string): AsyncGenerator<string> {
  const profile = toProfile(await getProfile(userId));
  yield `{"format":"solace-export","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},`;
  yield `"profile":${JSON.stringify(profile)},"entries":[`;
  yield* jsonArrayItems(entryPages(userId));
  yield `],"memories":[`;
  yield* jsonArrayItems(memoryPages(userId));
  yield `],"threads":[`;
  yield* jsonArrayItems(threadPages(userId));
  yield `]}\n`;
}

async function* jsonArrayItems(pages: AsyncIterable<unknown[]>): AsyncGenerator<string> {
  let first = true;
  for await (const page of pages) {
    if (page.length === 0) continue;
    yield (first ? '' : ',') + page.map((item) => JSON.stringify(item)).join(',');
    first = false;
  }
}

async function* memoryPages(userId: string) {
  const rows = await db
    .select({
      id: memories.id,
      kind: memories.kind,
      content: memories.content,
      confidence: memories.confidence,
      status: memories.status,
      firstSeen: memories.firstSeen,
      lastSeen: memories.lastSeen,
      sourceEntryIds: sql<
        string[]
      >`coalesce(array_agg(${memorySources.entryId}) filter (where ${memorySources.entryId} is not null), '{}')`,
    })
    .from(memories)
    .leftJoin(memorySources, eq(memorySources.memoryId, memories.id))
    .where(eq(memories.userId, userId))
    .groupBy(memories.id)
    .orderBy(asc(memories.firstSeen));
  yield rows.map((m) => ({
    ...m,
    firstSeen: m.firstSeen.toISOString(),
    lastSeen: m.lastSeen.toISOString(),
  }));
}

async function* threadPages(userId: string) {
  let after: string | undefined;
  for (;;) {
    const threads = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.userId, userId), after ? gt(chatThreads.id, after) : undefined))
      .orderBy(asc(chatThreads.id))
      .limit(THREAD_PAGE);
    if (threads.length === 0) return;
    const messages = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          inArray(
            chatMessages.threadId,
            threads.map((t) => t.id),
          ),
        ),
      )
      .orderBy(asc(chatMessages.createdAt));
    yield threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      messages: messages
        .filter((m) => m.threadId === t.id)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          createdAt: m.createdAt.toISOString(),
        })),
    }));
    if (threads.length < THREAD_PAGE) return;
    after = threads.at(-1)!.id;
  }
}

// ── Markdown export ────────────────────────────────────────────────────

/** One Markdown document with every entry, newest first. */
export async function* exportMarkdown(userId: string): AsyncGenerator<string> {
  const profile = await getProfile(userId);
  const who = profile.displayName ? ` of ${profile.displayName}` : '';
  yield `# Solace Diaries — the journal${who}\n\nExported ${new Date().toISOString().slice(0, 10)}.\n`;
  for await (const page of entryPages(userId)) {
    yield page.map(entryMarkdown).join('');
  }
}

function entryMarkdown(e: Entry): string {
  const title = e.title.replace(/\s+/g, ' ').trim() || 'Untitled entry';
  const meta = [`**Date:** ${e.entryDate}`];
  if (e.mood) meta.push(`**Mood:** ${e.mood}`);
  if (e.tags.length) meta.push(`**Tags:** ${e.tags.join(', ')}`);
  const photos = e.attachments.length
    ? `\n\n_${e.attachments.length} photo(s) — included in the JSON export._`
    : '';
  return `\n---\n\n## ${title}\n\n${meta.join(' · ')}\n\n${e.body.trim()}${photos}\n`;
}

// ── deletion ───────────────────────────────────────────────────────────

/**
 * Permanently delete the account: photos, every row (via ON DELETE CASCADE from profiles),
 * then the Supabase auth user. Each step is idempotent, so a failed attempt can be retried.
 */
export async function deleteAccount(auth: AuthContext, confirmEmail: string): Promise<void> {
  const { userId } = auth;
  const accountEmail = auth.email || (await getProfile(userId)).email;
  if (!accountEmail || confirmEmail.trim().toLowerCase() !== accountEmail.toLowerCase()) {
    throw badRequest("That email doesn't match your account.", {
      confirmEmail: 'Does not match your account email',
    });
  }

  await deletePrefix(`${userId}/`);
  await db.transaction(async (tx) => {
    await tx
      .delete(jobs)
      .where(and(sql`${jobs.payload}->>'userId' = ${userId}`, eq(jobs.status, 'queued')));
    await tx.delete(profiles).where(eq(profiles.id, userId));
  });
  forgetProfile(userId);
  if (!isTest) await deleteAuthUser(userId);
}
