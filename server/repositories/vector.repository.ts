import { prisma } from '../db.client';
import { VectorRecord } from '../db';

export class VectorRepository {
  async saveVector(record: VectorRecord): Promise<VectorRecord> {
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
    await prisma.$executeRaw`
      DELETE FROM "VectorRecord"
      WHERE "entryId" = ${entryId}
    `;
  }

  async findTopSimilar(userId: string, targetVector: number[], topK = 5): Promise<{ entryId: string; score: number }[]> {
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
