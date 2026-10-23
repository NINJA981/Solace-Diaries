/**
 * Reflect: grounded chat over the user's own journal. Each turn retrieves passages (vector +
 * full-text, fused, at most two per entry) and related memories, streams an answer that cites
 * passages as [n], and persists only the citations the answer actually used.
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AiStyle,
  type ApiError,
  type ChatMessage,
  type Citation,
  type Thread,
  type ThreadWithMessages,
} from '@solace/shared';
import { AiBadOutputError, AiUnavailableError, providerLimitError } from '../ai/errors';
import { embedModel, embedText, streamText, type AiOptions, type Turn } from '../ai/gemini';
import { DATA_POLICY, dataBlock, sanitize } from '../ai/untrusted';
import { db } from '../db/client';
import { chatMessages, chatThreads, entries, profiles } from '../db/schema';
import { HttpError, badRequest, notFound } from '../http/errors';
import { logger } from '../logger';
import { excerptOf } from './entry-dto';
import { similarMemories, type ScoredMemory } from './memories';
import { minSimilarity, rrf, vectorChunks, type ChunkHit } from './search';

export const CHAT_CHUNKS = 8;
export const MAX_CHUNKS_PER_ENTRY = 2;
export const CHAT_MEMORIES = 5;
export const HISTORY_MESSAGES = 8;
const HISTORY_CHARS = 1_200;
const TITLE_MAX = 60;
export const DEFAULT_THREAD_TITLE = 'New reflection';

type MessageRow = typeof chatMessages.$inferSelect;
type ThreadRow = typeof chatThreads.$inferSelect;

// ───────────────────────── threads CRUD ─────────────────────────

export const toThread = (t: ThreadRow): Thread => ({
  id: t.id,
  title: t.title,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const toChatMessage = (m: MessageRow): ChatMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  citations: m.citations,
  createdAt: m.createdAt.toISOString(),
});

export async function listThreads(userId: string): Promise<Thread[]> {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.userId, userId))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(100);
  return rows.map(toThread);
}

export async function createThread(userId: string, title?: string): Promise<Thread> {
  const [row] = await db
    .insert(chatThreads)
    .values({ userId, title: title?.trim() || DEFAULT_THREAD_TITLE })
    .returning();
  return toThread(row!);
}

async function threadRow(userId: string, id: string): Promise<ThreadRow> {
  const [row] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, userId)));
  if (!row) throw notFound('Conversation not found.');
  return row;
}

export async function getThread(userId: string, id: string): Promise<ThreadWithMessages> {
  const thread = await threadRow(userId, id);
  const messages = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, id), eq(chatMessages.userId, userId)))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return { ...toThread(thread), messages: messages.map(toChatMessage) };
}

export async function deleteThread(userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(chatThreads)
    .where(and(eq(chatThreads.id, id), eq(chatThreads.userId, userId)))
    .returning({ id: chatThreads.id });
  if (rows.length === 0) throw notFound('Conversation not found.');
}

export function titleFrom(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_MAX) return flat;
  const cut = flat.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ───────────────────────── turn preparation ─────────────────────────

export type PreparedTurn = {
  question: string;
  /** The newly stored user message, or null when regenerating. */
  userMessage: ChatMessage | null;
  /** Earlier messages, oldest first, excluding the question being answered. */
  history: MessageRow[];
};

/**
 * Store the user's message (or, for regenerate, drop the last answer and reuse the last
 * question), name a still-untitled thread after the first question, and load history.
 */
export async function prepareTurn(
  userId: string,
  threadId: string,
  input: { content: string; regenerate?: boolean },
): Promise<PreparedTurn> {
  const thread = await threadRow(userId, threadId);
  return db.transaction(async (tx) => {
    const scope = and(eq(chatMessages.threadId, threadId), eq(chatMessages.userId, userId));
    let current: MessageRow;
    let userMessage: ChatMessage | null = null;

    if (input.regenerate) {
      const [last] = await tx
        .select()
        .from(chatMessages)
        .where(scope)
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(1);
      if (last?.role === 'assistant')
        await tx.delete(chatMessages).where(eq(chatMessages.id, last.id));
      const [lastUser] = await tx
        .select()
        .from(chatMessages)
        .where(and(scope, eq(chatMessages.role, 'user')))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(1);
      if (!lastUser) throw badRequest('There is no question to regenerate an answer for.');
      current = lastUser;
    } else {
      const [row] = await tx
        .insert(chatMessages)
        .values({ threadId, userId, role: 'user', content: input.content })
        .returning();
      current = row!;
      userMessage = toChatMessage(current);
    }

    await tx
      .update(chatThreads)
      .set({
        updatedAt: sql`now()`,
        ...(thread.title === DEFAULT_THREAD_TITLE ? { title: titleFrom(current.content) } : {}),
      })
      .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)));

    const recent = await tx
      .select()
      .from(chatMessages)
      .where(and(scope, ne(chatMessages.id, current.id)))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(HISTORY_MESSAGES);
    return { question: current.content, userMessage, history: recent.reverse() };
  });
}

// ───────────────────────── retrieval ─────────────────────────

/** Full-text over chunk text with OR semantics (questions are phrased, not keyword lists). */
async function keywordChunks(userId: string, question: string, limit = 20): Promise<ChunkHit[]> {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 16);
  if (terms.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    entry_id: string;
    entry_date: string;
    content: string;
  }>(sql`
    with q as (select to_tsquery('english', ${terms.join(' | ')}) as query)
    select c.id, c.entry_id, e.entry_date::text as entry_date, c.content
    from entry_chunks c join entries e on e.id = c.entry_id, q
    where c.user_id = ${userId} and c.model = ${embedModel()}
      and e.search @@ q.query and to_tsvector('english', c.content) @@ q.query
    order by ts_rank_cd(to_tsvector('english', c.content), q.query) desc
    limit ${limit}`);
  return rows.map((r) => ({
    chunkId: r.id,
    entryId: r.entry_id,
    entryDate: r.entry_date,
    content: r.content,
    similarity: 0,
  }));
}

/** RRF over chunk ids, then greedy pick with a per-entry cap so one long entry can't crowd out the rest. */
export function selectChunks(vector: ChunkHit[], keyword: ChunkHit[]): ChunkHit[] {
  const byId = new Map<string, ChunkHit>();
  for (const c of [...keyword, ...vector]) byId.set(c.chunkId, c);
  const fused = [...rrf([vector.map((c) => c.chunkId), keyword.map((c) => c.chunkId)])].sort(
    (a, b) => b[1] - a[1],
  );
  const perEntry = new Map<string, number>();
  const picked: ChunkHit[] = [];
  for (const [id] of fused) {
    const c = byId.get(id)!;
    const n = perEntry.get(c.entryId) ?? 0;
    if (n >= MAX_CHUNKS_PER_ENTRY) continue;
    perEntry.set(c.entryId, n + 1);
    picked.push(c);
    if (picked.length === CHAT_CHUNKS) break;
  }
  return picked;
}

type Passage = Citation & { content: string };
type Retrieved = { citations: Citation[]; passages: Passage[]; memories: ScoredMemory[] };

async function retrieve(
  userId: string,
  question: string,
  history: MessageRow[],
  ai: AiOptions,
): Promise<Retrieved> {
  // The last two turns give follow-ups like "and after that?" something to anchor on.
  const context = history
    .slice(-2)
    .map((m) => m.content.slice(0, 500))
    .join('\n');
  const vector = await embedText(`${context}\n${question}`.trim(), 'RETRIEVAL_QUERY', ai);
  const [vec, kw, memories] = await Promise.all([
    vectorChunks(userId, vector),
    keywordChunks(userId, question),
    similarMemories(userId, vector, CHAT_MEMORIES, minSimilarity()),
  ]);
  const chunks = selectChunks(vec, kw);
  if (chunks.length === 0) return { citations: [], passages: [], memories };

  const meta = await db
    .select({ id: entries.id, title: entries.title, entryDate: entries.entryDate })
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        inArray(entries.id, [...new Set(chunks.map((c) => c.entryId))]),
      ),
    );
  const byId = new Map(meta.map((m) => [m.id, m]));
  const passages: Passage[] = [];
  for (const c of chunks) {
    const m = byId.get(c.entryId);
    if (!m) continue;
    passages.push({
      n: passages.length + 1,
      entryId: m.id,
      title: m.title || 'Untitled',
      entryDate: m.entryDate,
      snippet: excerptOf(c.content, 280),
      content: c.content,
    });
  }
  return {
    citations: passages.map(({ content: _content, ...citation }) => citation),
    passages,
    memories,
  };
}

// ───────────────────────── prompting ─────────────────────────

const STYLE: Record<AiStyle, string> = {
  gentle: 'Gentle and validating: lead with empathy and soft wording.',
  direct: 'Clear and straightforward: kind, but to the point, with little cushioning.',
  curious: 'Curious and exploratory: notice patterns and end with one open question.',
  stoic:
    'Calm and grounded, in the spirit of Stoic reflection: focus on what is within their control.',
};

export function systemPrompt(style: AiStyle, today: string): string {
  return `You are Solace, a warm, thoughtful companion inside the user's private journal. You help them reflect on their own past entries.
Voice: ${STYLE[style]}
Ground rules:
- Draw only on the journal excerpts and memories provided with the question, and on this conversation. Never invent events, people, dates or feelings.
- Cite the excerpts you use by number in square brackets right after the sentence they support, like [1] or [2][3]. Only use numbers you were given.
- If the excerpts don't cover the question, say so plainly and kindly (for example "I couldn't find anything about that in your journal"), and offer a gentle reflective question instead of guessing.
- Be concise: usually two to five short paragraphs, or a few bullets. Speak to the user as "you". Plain Markdown only: no headings, images, links or HTML.
- You are not a therapist. Never diagnose or label conditions, and don't give medical, legal or financial instructions.
- If the user expresses thoughts of suicide, self-harm, or being in danger, respond with warmth first, encourage them to contact local emergency services or a crisis line right now (for example, call or text 988 in the US, or the local equivalent) or someone they trust, and keep everything else brief.
- Today's date is ${today}.
${DATA_POLICY}`;
}

const CITATION_MARKS = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Strip [n] markers from old answers: their numbering belonged to an earlier turn's excerpts. */
export function historyTurns(history: MessageRow[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    const role = m.role === 'user' ? 'user' : 'model';
    let text = m.content.replace(CITATION_MARKS, '').trim();
    if (text.length > HISTORY_CHARS) text = `${text.slice(0, HISTORY_CHARS)}…`;
    if (!text) continue;
    const prev = turns[turns.length - 1];
    if (prev?.role === role) prev.parts.push({ text });
    else turns.push({ role, parts: [{ text }] });
  }
  while (turns[0]?.role === 'model') turns.shift();
  return turns;
}

function userTurn(question: string, r: Retrieved): string {
  const excerpts = r.passages.length
    ? r.passages
        .map((p) =>
          dataBlock(
            'journal_excerpt',
            { n: p.n, date: p.entryDate, title: p.title },
            p.content,
            3_000,
          ),
        )
        .join('\n')
    : 'No journal excerpts matched this question.';
  const memories = r.memories.length
    ? r.memories.map((m) => dataBlock('memory', { kind: m.kind }, m.content, 400)).join('\n')
    : '(none)';
  return `Journal excerpts:\n${excerpts}\n\nThings Solace remembers about the user:\n${memories}\n\nQuestion: ${sanitize(question, 2_000)}`;
}

/** Citations the answer referenced that we actually provided. */
export function referencedCitations(answer: string, citations: Citation[]): Citation[] {
  const used = new Set<number>();
  for (const match of answer.matchAll(CITATION_MARKS)) {
    for (const n of match[1]!.split(',')) used.add(Number(n.trim()));
  }
  return citations.filter((c) => used.has(c.n));
}

// ───────────────────────── the streamed turn ─────────────────────────

export type Emit = (event: 'sources' | 'token' | 'done' | 'error', data: unknown) => void;

export function toApiError(err: unknown, requestId?: string, ownKey = false): ApiError {
  if (err instanceof AiUnavailableError && err.status === 429) {
    const limit = providerLimitError(err, ownKey);
    return { error: limit.message, code: limit.code, requestId };
  }
  if (err instanceof AiUnavailableError || err instanceof AiBadOutputError) {
    return {
      error: 'Solace could not reach its AI service. Try again in a moment.',
      code: ERROR_CODES.aiUnavailable,
      requestId,
    };
  }
  if (err instanceof HttpError) return { error: err.message, code: err.code, requestId };
  return { error: 'Something went wrong while answering.', code: ERROR_CODES.internal, requestId };
}

async function aiStyleOf(userId: string): Promise<AiStyle> {
  const [p] = await db
    .select({ aiStyle: profiles.aiStyle })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return p?.aiStyle ?? 'gentle';
}

async function saveAnswer(
  userId: string,
  threadId: string,
  content: string,
  citations: Citation[],
): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(chatMessages)
      .values({ threadId, userId, role: 'assistant', content, citations })
      .returning();
    await tx
      .update(chatThreads)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)));
    return toChatMessage(row!);
  });
}

/**
 * Run one answer: sources → tokens → done, or a terminal error event. Never throws. If the
 * client goes away (`signal`), generation stops and any partial answer is kept.
 */
export async function runTurn(args: {
  userId: string;
  threadId: string;
  turn: PreparedTurn;
  ai: AiOptions;
  signal: AbortSignal;
  emit: Emit;
  requestId?: string;
}): Promise<void> {
  const { userId, threadId, turn, signal, emit } = args;
  const ai: AiOptions = { ...args.ai, userId, signal };
  let answer = '';
  let citations: Citation[] = [];
  try {
    const retrieved = await retrieve(userId, turn.question, turn.history, ai);
    citations = retrieved.citations;
    emit('sources', { citations });

    const today = new Date().toISOString().slice(0, 10);
    const stream = streamText(
      {
        task: 'chat',
        system: systemPrompt(await aiStyleOf(userId), today),
        history: historyTurns(turn.history),
        user: userTurn(turn.question, retrieved),
        temperature: 0.6,
        maxOutputTokens: 1_200,
      },
      ai,
    );
    for await (const text of stream) {
      answer += text;
      emit('token', { text });
    }
    const message = await saveAnswer(
      userId,
      threadId,
      answer.trim(),
      referencedCitations(answer, citations),
    );
    emit('done', { message, userMessage: turn.userMessage });
  } catch (err) {
    if (signal.aborted) {
      if (answer.trim()) {
        await saveAnswer(
          userId,
          threadId,
          answer.trim(),
          referencedCitations(answer, citations),
        ).catch((e: unknown) => logger.warn({ err: e }, 'failed to keep partial answer'));
      }
      return;
    }
    logger.warn({ err, threadId }, 'reflect turn failed');
    emit('error', toApiError(err, args.requestId, Boolean(args.ai.apiKey)));
  }
}
