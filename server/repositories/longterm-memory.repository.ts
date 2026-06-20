import crypto from 'crypto';
import { prisma, shouldUseMock } from '../db.client';
import { Memory as PrismaMemory } from '@prisma/client';
import { Database, DbMemory } from '../db';

export class LongTermMemoryRepository {
  async create(
    userId: string,
    content: string,
    confidence: number,
    vector: number[]
  ): Promise<PrismaMemory> {
    const now = new Date();
    if (shouldUseMock()) {
      const memories = Database.getLongTermMemories();
      const newMemory: DbMemory = {
        id: crypto.randomUUID(),
        userId,
        content,
        confidence,
        vector,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      memories.push(newMemory);
      Database.saveLongTermMemories(memories);
      return {
        id: newMemory.id,
        userId: newMemory.userId,
        content: newMemory.content,
        confidence: newMemory.confidence,
        createdAt: new Date(newMemory.createdAt),
        updatedAt: new Date(newMemory.updatedAt)
      } as PrismaMemory;
    }

    const vectorString = `[${vector.join(',')}]`;
    const id = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "Memory" (id, "userId", content, confidence, vector, "createdAt", "updatedAt")
      VALUES (${id}, ${userId}, ${content}, ${confidence}, ${vectorString}::vector, ${now}, ${now})
    `;

    const created = await prisma.memory.findUnique({ where: { id } });
    if (!created) throw new Error('Failed to retrieve newly created memory');
    return created;
  }

  async update(
    id: string,
    content: string,
    confidence: number,
    vector: number[]
  ): Promise<PrismaMemory> {
    const now = new Date();
    if (shouldUseMock()) {
      const memories = Database.getLongTermMemories();
      const idx = memories.findIndex((m) => m.id === id);
      if (idx === -1) {
        throw new Error('Memory not found');
      }
      memories[idx].content = content;
      memories[idx].confidence = confidence;
      memories[idx].vector = vector;
      memories[idx].updatedAt = now.toISOString();
      Database.saveLongTermMemories(memories);
      const m = memories[idx];
      return {
        id: m.id,
        userId: m.userId,
        content: m.content,
        confidence: m.confidence,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt)
      } as PrismaMemory;
    }

    const vectorString = `[${vector.join(',')}]`;

    await prisma.$executeRaw`
      UPDATE "Memory"
      SET content = ${content},
          confidence = ${confidence},
          vector = ${vectorString}::vector,
          "updatedAt" = ${now}
      WHERE id = ${id}
    `;

    const updated = await prisma.memory.findUnique({ where: { id } });
    if (!updated) throw new Error('Failed to retrieve updated memory');
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (shouldUseMock()) {
      const memories = Database.getLongTermMemories();
      const filtered = memories.filter((m) => m.id !== id);
      const deleted = filtered.length < memories.length;
      Database.saveLongTermMemories(filtered);
      return deleted;
    }

    const res = await prisma.memory.delete({
      where: { id }
    });
    return !!res;
  }

  async findById(id: string): Promise<PrismaMemory | null> {
    if (shouldUseMock()) {
      const m = Database.getLongTermMemories().find((mem) => mem.id === id);
      if (!m) return null;
      return {
        id: m.id,
        userId: m.userId,
        content: m.content,
        confidence: m.confidence,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt)
      } as PrismaMemory;
    }
    return prisma.memory.findUnique({
      where: { id }
    });
  }

  async findAllByUserId(userId: string): Promise<PrismaMemory[]> {
    if (shouldUseMock()) {
      const memories = Database.getLongTermMemories().filter((m) => m.userId === userId);
      return memories.map((m) => ({
        id: m.id,
        userId: m.userId,
        content: m.content,
        confidence: m.confidence,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt)
      })) as PrismaMemory[];
    }
    return prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findTopSimilar(
    userId: string,
    targetVector: number[],
    topK = 5
  ): Promise<{ id: string; content: string; confidence: number; score: number }[]> {
    if (shouldUseMock()) {
      const memories = Database.getLongTermMemories().filter((m) => m.userId === userId);
      const calculated = memories.map((m) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < targetVector.length; i++) {
          const a = targetVector[i] || 0;
          const b = m.vector[i] || 0;
          dotProduct += a * b;
          normA += a * a;
          normB += b * b;
        }
        const similarity = normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
        const score = 0.8 * similarity + 0.2 * m.confidence;

        return {
          id: m.id,
          content: m.content,
          confidence: m.confidence,
          score
        };
      });

      return calculated
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    const vectorString = `[${targetVector.join(',')}]`;

    const results = await prisma.$queryRaw<
      Array<{ id: string; content: string; confidence: number; score: number }>
    >`
      SELECT id, content, confidence,
             ((1 - (vector <=> ${vectorString}::vector)) * 0.8 + confidence * 0.2) AS "score"
      FROM "Memory"
      WHERE "userId" = ${userId}
      ORDER BY ((1 - (vector <=> ${vectorString}::vector)) * 0.8 + confidence * 0.2) DESC
      LIMIT ${topK}
    `;

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      confidence: Number(r.confidence),
      score: Number(r.score)
    }));
  }
}
