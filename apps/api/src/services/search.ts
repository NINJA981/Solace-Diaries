/**
 * Journal search. Keyword mode is Postgres full-text search. Hybrid mode fuses vector
 * similarity over entry chunks with full-text ranks using Reciprocal Rank Fusion, then
 * applies a small recency nudge. A similarity floor keeps unrelated queries empty.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Mood, SearchHit, SearchQuery, SearchResult } from '@solace/shared';
import { daysBetween, ERROR_CODES } from '@solace/shared';
import { AiUnavailableError } from '../ai/errors';
import { embedModel, embedText, type AiOptions } from '../ai/gemini';
import { HttpError } from '../http/errors';
import { config } from '../config';
import { db } from '../db/client';
import { entries } from '../db/schema';
import { excerptOf, toEntrySummary } from './entry-dto';
import { vectorLiteral } from './memories';
import { consumeAiQuota } from './quota';

/** Nearest chunks fetched from the HNSW index per query. */
export const VECTOR_TOP_K = 40;
export const HNSW_EF_SEARCH = 80;
/** Standard RRF constant: dampens the advantage of the very top ranks. */
export const RRF_K = 60;
/** Cosine similarity below which a chunk is considered unrelated (see config). */
export const minSimilarity = () => config.SEARCH_MIN_SIMILARITY;
/** Recency can add at most this fraction of a hit's fused score. */
export const RECENCY_WEIGHT = 0.05;
export const RECENCY_HALF_LIFE_DAYS = 180;
const KEYWORD_CANDIDATES = 40;

export type SearchFilters = { mood?: Mood; tag?: string; from?: string; to?: string };

export type ChunkHit = {
  chunkId: string;
  entryId: string;
  entryDate: string;
  content: string;
  similarity: number;
};
export type KeywordHit = { entryId: string; entryDate: string; rank: number };

/** Filters on the `e` (entries) alias, applied inside the SQL. */
function filterSql(f: SearchFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.mood) parts.push(sql`e.mood = ${f.mood}`);
  if (f.tag) parts.push(sql`e.tags @> array[${f.tag.trim().toLowerCase()}]::text[]`);
  if (f.from) parts.push(sql`e.entry_date >= ${f.from}`);
  if (f.to) parts.push(sql`e.entry_date <= ${f.to}`);
  return sql.join(parts, sql` and `);
}

/**
 * Nearest chunks for the user. The distance appears only in ORDER BY so the HNSW index
 * drives the scan; iterative scanning keeps going past other users' rows until enough of
 * this user's chunks are found. Results under the similarity floor are dropped.
 */
export async function vectorChunks(
  userId: string,
  vector: number[],
  filters: SearchFilters = {},
  limit = VECTOR_TOP_K,
): Promise<ChunkHit[]> {
  const v = vectorLiteral(vector);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local hnsw.ef_search = ${HNSW_EF_SEARCH}`));
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    return tx.execute<{
      id: string;
      entry_id: string;
      entry_date: string;
      content: string;
      similarity: number;
    }>(sql`
      select c.id, c.entry_id, e.entry_date::text as entry_date, c.content, 1 - (c.embedding <=> ${v}) as similarity
      from entry_chunks c
      join entries e on e.id = c.entry_id
      where c.user_id = ${userId} and c.model = ${embedModel()} and ${filterSql(filters)}
      order by c.embedding <=> ${v}
      limit ${limit}`);
  });
  return rows
    .map((r) => ({
      chunkId: r.id,
      entryId: r.entry_id,
      entryDate: r.entry_date,
      content: r.content,
      similarity: Number(r.similarity),
    }))
    .filter((r) => r.similarity >= minSimilarity())
    .sort((a, b) => b.similarity - a.similarity)
    .filter((r, _, sorted) => withinBand(r.similarity, sorted[0]!.similarity));
}

/** Keep only hits close to the best one: real embeddings put weak matches just over the floor. */
export function withinBand(similarity: number, best: number, band = config.SEARCH_RELATIVE_BAND): boolean {
  return best - similarity <= band;
}

/** Full-text matches using web-search syntax ("quoted phrases", -exclusions, or). */
export async function keywordEntries(
  userId: string,
  q: string,
  filters: SearchFilters = {},
  limit = KEYWORD_CANDIDATES,
): Promise<KeywordHit[]> {
  const rows = await db.execute<{ id: string; entry_date: string; rank: number }>(sql`
    select e.id, e.entry_date::text as entry_date, ts_rank_cd(e.search, query) as rank
    from entries e, websearch_to_tsquery('english', ${q}) query
    where e.user_id = ${userId} and e.search @@ query and ${filterSql(filters)}
    order by rank desc, e.entry_date desc
    limit ${limit}`);
  return rows.map((r) => ({ entryId: r.id, entryDate: r.entry_date, rank: Number(r.rank) }));
}

/** Reciprocal Rank Fusion over ranked id lists: Σ 1 / (k + rank). */
export function rrf(lists: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

/** Multiply by at most (1 + RECENCY_WEIGHT), decaying with a half-life — a tie-breaker, not a ranking. */
export function withRecency(score: number, entryDate: string, today: string): number {
  const age = Math.max(0, daysBetween(entryDate, today));
  return score * (1 + RECENCY_WEIGHT * 0.5 ** (age / RECENCY_HALF_LIFE_DAYS));
}

/** Best chunk per entry, preserving similarity order. */
export function bestChunkPerEntry(chunks: ChunkHit[]): Map<string, ChunkHit> {
  const best = new Map<string, ChunkHit>();
  for (const c of chunks) if (!best.has(c.entryId)) best.set(c.entryId, c);
  return best;
}

type Ranked = { entryId: string; score: number; chunk?: ChunkHit; keyword: boolean };

/** One query for the final page: rows, attachment counts and keyword headlines together. */
async function hydrate(userId: string, q: string, ranked: Ranked[]): Promise<SearchHit[]> {
  if (ranked.length === 0) return [];
  const rows = await db
    .select({
      entry: entries,
      attachmentCount: sql<number>`(select count(*)::int from attachments a where a.entry_id = ${entries.id})`,
      headline: sql<string>`ts_headline('english', ${entries.body} || ' ' || ${entries.attachmentText},
        websearch_to_tsquery('english', ${q}),
        'MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""')`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        inArray(
          entries.id,
          ranked.map((r) => r.entryId),
        ),
      ),
    );
  const byId = new Map(rows.map((r) => [r.entry.id, r]));
  return ranked.flatMap((r) => {
    const row = byId.get(r.entryId);
    if (!row) return [];
    const entry = toEntrySummary(row.entry, row.attachmentCount);
    const headline = (row.headline ?? '').replace(/\s+/g, ' ').trim();
    const snippet =
      r.keyword && headline ? headline : excerptOf(r.chunk?.content ?? entry.excerpt, 240);
    const matchedBy: SearchHit['matchedBy'] = [];
    if (r.chunk) matchedBy.push('meaning');
    if (r.keyword) matchedBy.push('keyword');
    return [{ entry, snippet, score: r.score, matchedBy }];
  });
}

export async function searchEntries(
  userId: string,
  query: SearchQuery,
  ai: AiOptions = {},
): Promise<SearchResult> {
  const filters: SearchFilters = {
    mood: query.mood,
    tag: query.tag,
    from: query.from,
    to: query.to,
  };

  const keywordOnly = async (): Promise<SearchResult> => {
    const kw = await keywordEntries(userId, query.q, filters, query.limit);
    const ranked = kw.map((k) => ({ entryId: k.entryId, score: k.rank, keyword: true }));
    return { mode: 'keyword', hits: await hydrate(userId, query.q, ranked) };
  };

  if (query.mode === 'keyword') return keywordOnly();

  // Search must keep working without AI: if the model is unreachable or today's quota is
  // spent, answer with exact-word results and say so via `mode: 'keyword'`.
  let vector: number[];
  try {
    await consumeAiQuota(userId, { usingOwnKey: Boolean(ai.apiKey) });
    vector = await embedText(query.q, 'RETRIEVAL_QUERY', { ...ai, userId });
  } catch (err) {
    const quotaSpent = err instanceof HttpError && err.code === ERROR_CODES.quotaExceeded;
    if (err instanceof AiUnavailableError || quotaSpent) return keywordOnly();
    throw err;
  }
  const [chunks, kw] = await Promise.all([
    vectorChunks(userId, vector, filters),
    keywordEntries(userId, query.q, filters),
  ]);

  const best = bestChunkPerEntry(chunks);
  const keywordIds = new Set(kw.map((k) => k.entryId));
  const dates = new Map<string, string>();
  for (const c of best.values()) dates.set(c.entryId, c.entryDate);
  for (const k of kw) dates.set(k.entryId, k.entryDate);

  const today = new Date().toISOString().slice(0, 10);
  const fused = rrf([[...best.keys()], kw.map((k) => k.entryId)]);
  const ranked: Ranked[] = [...fused]
    .map(([entryId, score]) => ({
      entryId,
      score: withRecency(score, dates.get(entryId)!, today),
      chunk: best.get(entryId),
      keyword: keywordIds.has(entryId),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit);

  return { mode: 'hybrid', hits: await hydrate(userId, query.q, ranked) };
}
