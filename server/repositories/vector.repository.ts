import { prisma, shouldUseMock } from '../db.client';
import { VectorRecord, Database } from '../db';

export class VectorRepository {
  async saveVector(record: VectorRecord): Promise<VectorRecord> {
    if (shouldUseMock()) {
      const vectors = Database.getVectors();
      const filtered = vectors.filter((v) => v.entryId !== record.entryId);
      filtered.push(record);
      Database.saveVectors(filtered);
      return record;
    }

    await prisma.$executeRaw`
      DELETE FROM "VectorRecord"
      WHERE "entryId" = ${record.entryId}
    `;

    const vectorString = `[${record.vector.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO "VectorRecord" (id, "entryId", "userId", vector, "createdAt")
      VALUES (${record.id}, ${record.entryId}, ${record.userId}, ${vectorString}::vector, ${new Date(record.createdAt)})
    `;

    return record;
  }

  async deleteVectorByEntryId(entryId: string): Promise<void> {
    if (shouldUseMock()) {
      const vectors = Database.getVectors();
      const filtered = vectors.filter((v) => v.entryId !== entryId);
      Database.saveVectors(filtered);
      return;
    }

    await prisma.$executeRaw`
      DELETE FROM "VectorRecord"
      WHERE "entryId" = ${entryId}
    `;
  }

  async findTopSimilar(userId: string, targetVector: number[], topK = 5): Promise<{ entryId: string; score: number }[]> {
    if (shouldUseMock()) {
      const vectors = Database.getVectors().filter((v) => v.userId === userId);
      
      const calculated = vectors.map((v) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < targetVector.length; i++) {
          const a = targetVector[i] || 0;
          const b = v.vector[i] || 0;
          dotProduct += a * b;
          normA += a * a;
          normB += b * b;
        }
        const score = normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
        return { entryId: v.entryId, score };
      });
      
      return calculated
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    const vectorString = `[${targetVector.join(',')}]`;

    const results = await prisma.$queryRaw<Array<{ entryId: string; score: number }>>`
      SELECT "entryId", (1 - (vector <=> ${vectorString}::vector)) AS "score"
      FROM "VectorRecord"
      WHERE "userId" = ${userId}
      ORDER BY vector <=> ${vectorString}::vector ASC
      LIMIT ${topK}
    `;

    return results.map((r) => ({
      entryId: r.entryId,
      score: Number(r.score)
    }));
  }
}
