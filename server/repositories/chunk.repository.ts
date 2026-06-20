import { prisma, shouldUseMock } from '../db.client';
import { JournalChunk, Database } from '../db';

export class ChunkRepository {
  async saveChunk(record: JournalChunk): Promise<JournalChunk> {
    if (shouldUseMock()) {
      const chunks = Database.getChunks();
      chunks.push(record);
      Database.saveChunks(chunks);
      return record;
    }

    const vectorString = `[${record.vector.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO "JournalChunk" (id, "entryId", content, "chunkIndex", vector, "createdAt")
      VALUES (${record.id}, ${record.entryId}, ${record.content}, ${record.chunkIndex}, ${vectorString}::vector, ${new Date(record.createdAt)})
    `;

    return record;
  }

  async deleteChunksByEntryId(entryId: string): Promise<void> {
    if (shouldUseMock()) {
      const chunks = Database.getChunks();
      const filtered = chunks.filter((c) => c.entryId !== entryId);
      Database.saveChunks(filtered);
      return;
    }

    await prisma.$executeRaw`
      DELETE FROM "JournalChunk"
      WHERE "entryId" = ${entryId}
    `;
  }

  async findTopSimilar(
    userId: string,
    targetVector: number[],
    topK = 5
  ): Promise<{ entryId: string; content: string; chunkIndex: number; score: number; similarity: number }[]> {
    if (shouldUseMock()) {
      const entries = Database.getEntries().filter((e) => e.userId === userId);
      const entryIds = new Set(entries.map((e) => e.id));
      const chunks = Database.getChunks().filter((c) => entryIds.has(c.entryId));

      const calculated = chunks.map((c) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < targetVector.length; i++) {
          const a = targetVector[i] || 0;
          const b = c.vector[i] || 0;
          dotProduct += a * b;
          normA += a * a;
          normB += b * b;
        }
        const similarity = normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
        
        // Calculate days elapsed and exponential time-decay recency bonus
        const daysElapsed = (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const recencyBonus = 0.15 * Math.exp(-daysElapsed / 30);
        const score = similarity + recencyBonus;

        return {
          entryId: c.entryId,
          content: c.content,
          chunkIndex: c.chunkIndex,
          score,
          similarity
        };
      });

      return calculated
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    const vectorString = `[${targetVector.join(',')}]`;

    const results = await prisma.$queryRaw<
      Array<{ entryId: string; content: string; chunkIndex: number; score: number; similarity: number }>
    >`
      SELECT jc."entryId", jc.content, jc."chunkIndex", 
             (1 - (jc.vector <=> ${vectorString}::vector)) AS "similarity",
             ((1 - (jc.vector <=> ${vectorString}::vector)) + (0.15 * EXP(-1.0 * EXTRACT(EPOCH FROM (NOW() - je."createdAt")) / 2592000))) AS "score"
      FROM "JournalChunk" jc
      JOIN "JournalEntry" je ON jc."entryId" = je.id
      WHERE je."userId" = ${userId}
      ORDER BY ((1 - (jc.vector <=> ${vectorString}::vector)) + (0.15 * EXP(-1.0 * EXTRACT(EPOCH FROM (NOW() - je."createdAt")) / 2592000))) DESC
      LIMIT ${topK}
    `;

    return results.map((r) => ({
      entryId: r.entryId,
      content: r.content,
      chunkIndex: Number(r.chunkIndex),
      score: Number(r.score),
      similarity: Number(r.similarity)
    }));
  }
}
