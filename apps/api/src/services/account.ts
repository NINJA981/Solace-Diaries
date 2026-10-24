/** Data ownership: full export (JSON / Markdown) and account deletion. */
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Entry } from '@solace/shared';
import { isTest } from '../config';
import { db } from '../db/client';
import {
  capsules,
  chapters,
  chatMessages,
  chatThreads,
  growthNotes,
  intentionCheckins,
  intentions,
  jobs,
  memories,
  memorySources,
  parentalConsents,
  pastLetters,
  profiles,
} from '../db/schema';
import { deleteAuthUser } from '../auth/supabase-admin';
import { badRequest } from '../http/errors';
import type { AuthContext } from '../http/types';
import { deletePrefix } from '../storage';
import { entryPages } from './entries';
import { toCapsule } from './capsules';
import { toPastLetter } from './letters';
import { forgetProfile, getProfile, toProfile } from './profiles';

const THREAD_PAGE = 50;
/** Bump when the shape of the JSON export changes. 2 added the v3 data (capsules and more). */
export const EXPORT_VERSION = 2;

// ── JSON export ────────────────────────────────────────────────────────

/** Streams the export as JSON text chunks, a page at a time, so memory stays flat. */
export async function* exportJson(userId: string): AsyncGenerator<string> {
  const profileRow = await getProfile(userId);
  const profile = toProfile(profileRow);
  yield `{"format":"solace-export","version":${EXPORT_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},`;
  yield `"profile":${JSON.stringify(profile)},"entries":[`;
  yield* jsonArrayItems(entryPages(userId));
  yield `],"memories":[`;
  yield* jsonArrayItems(memoryPages(userId));
  yield `],"threads":[`;
  yield* jsonArrayItems(threadPages(userId));
  const v3 = await v3Data(userId, profileRow.mode === 'teen');
  yield `],"capsules":${JSON.stringify(v3.capsules)},"letters":${JSON.stringify(v3.letters)},`;
  yield `"chapters":${JSON.stringify(v3.chapters)},"growthNotes":${JSON.stringify(v3.growthNotes)},`;
  yield `"intentions":${JSON.stringify(v3.intentions)},"consent":${JSON.stringify(v3.consent)}}\n`;
}

/**
 * Everything the v3 features add. Capsules go through `toCapsule`, so the body of a sealed
 * (or ready but unopened) capsule is null: the export is not a way around the seal. Consent
 * is a summary only (status and when it was decided), never the stored hashes.
 */
async function v3Data(userId: string, teen: boolean) {
  const now = new Date();
  const [capsuleRows, letterRows, chapterRows, noteRows, intentionRows, checkinRows, consentRows] =
    await Promise.all([
      db.select().from(capsules).where(eq(capsules.userId, userId)).orderBy(asc(capsules.unlockAt)),
      db.select().from(pastLetters).where(eq(pastLetters.userId, userId)).orderBy(asc(pastLetters.month)),
      db
        .select()
        .from(chapters)
        .where(eq(chapters.userId, userId))
        .orderBy(asc(chapters.fromDate), asc(chapters.createdAt)),
      db.select().from(growthNotes).where(eq(growthNotes.userId, userId)).orderBy(asc(growthNotes.weekStart)),
      db.select().from(intentions).where(eq(intentions.userId, userId)).orderBy(asc(intentions.createdAt)),
      db
        .select()
        .from(intentionCheckins)
        .where(eq(intentionCheckins.userId, userId))
        .orderBy(asc(intentionCheckins.date)),
      db
        .select({ status: parentalConsents.status, decidedAt: parentalConsents.decidedAt })
        .from(parentalConsents)
        .where(eq(parentalConsents.userId, userId))
        .orderBy(desc(parentalConsents.requestedAt))
        .limit(1),
    ]);
  const checkinsBy = new Map<string, { date: string; note: string | null }[]>();
  for (const c of checkinRows) {
    const list = checkinsBy.get(c.intentionId) ?? [];
    list.push({ date: c.date, note: c.note });
    checkinsBy.set(c.intentionId, list);
  }
  const profile = await getProfile(userId);
  return {
    capsules: capsuleRows.map((r) => toCapsule(r, now)),
    letters: letterRows.map(toPastLetter),
    chapters: chapterRows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      from: r.fromDate,
      to: r.toDate,
      color: r.color,
      cast: teen ? [] : r.cast,
      keyEntryIds: r.keyEntryIds,
    })),
    growthNotes: noteRows.map((r) => ({
      id: r.id,
      weekStart: r.weekStart,
      text: r.text,
      citations: r.citations,
      createdAt: r.createdAt.toISOString(),
    })),
    intentions: intentionRows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      cadence: r.cadence,
      status: r.status,
      source: r.source,
      memoryId: r.memoryId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      checkins: checkinsBy.get(r.id) ?? [],
    })),
    consent: {
      status: profile.consentStatus,
      decidedAt: consentRows[0]?.decidedAt?.toISOString() ?? null,
    },
  };
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
  yield* v3Markdown(userId);
}

const day = (iso: string) => iso.slice(0, 10);
const NL = String.fromCharCode(10);
const lines = (...parts: string[]) => parts.join(NL);

/** Capsules (title and date only: never a body), letters from past self, and intentions. */
async function* v3Markdown(userId: string): AsyncGenerator<string> {
  const v3 = await v3Data(userId, false);
  if (v3.capsules.length) {
    yield lines('', '---', '', '# Time capsules', '', '_Letters to your future self. Their text stays out of this file._', '', '');
    yield v3.capsules
      .map((c) => `- **${oneLine(c.title)}** — unlocks ${day(c.unlockAt)} (${c.status})${NL}`)
      .join('');
  }
  if (v3.letters.length) {
    yield lines('', '---', '', '# Letters from your past self', '');
    yield v3.letters.map((l) => lines('', `## ${l.month}`, '', l.content.trim(), '')).join('');
  }
  if (v3.intentions.length) {
    yield lines('', '---', '', '# Intentions', '', '');
    yield v3.intentions
      .map((i) => `- **${oneLine(i.title)}** — ${i.kind}, ${i.status}, ${i.checkins.length} check-in(s)${NL}`)
      .join('');
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim() || 'Untitled';

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

  await purgeAccount(userId);
}

/** Delete everything of one account without asking for an email (also used by the under-13 gate). */
export async function purgeAccount(userId: string): Promise<void> {
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
