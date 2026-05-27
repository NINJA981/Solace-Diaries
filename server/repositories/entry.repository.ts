import { prisma } from '../db.client';
import { JournalEntry } from '../db';

export class EntryRepository {
  async findAllByUserId(userId: string): Promise<JournalEntry[]> {
    const entries = await prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    return entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString()
    }));
  }

  async findById(id: string, userId: string): Promise<JournalEntry | null> {
    const entry = await prisma.journalEntry.findFirst({
      where: { id, userId }
    });
    if (!entry) return null;
    return {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString()
    };
  }

  async create(entry: JournalEntry): Promise<JournalEntry> {
    const created = await prisma.journalEntry.create({
      data: {
        id: entry.id,
        userId: entry.userId,
        title: entry.title,
        content: entry.content,
        mood: entry.mood,
        tags: entry.tags,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt)
      }
    });
    return {
      ...created,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString()
    };
  }

  async update(id: string, userId: string, update: Partial<Omit<JournalEntry, 'id' | 'userId' | 'createdAt'>>): Promise<JournalEntry | null> {
    const existing = await prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!existing) return null;

    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        ...(update.title !== undefined && { title: update.title }),
        ...(update.content !== undefined && { content: update.content }),
        ...(update.mood !== undefined && { mood: update.mood }),
        ...(update.tags !== undefined && { tags: update.tags })
      }
    });
    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    };
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!existing) return false;

    await prisma.journalEntry.delete({
      where: { id }
    });
    return true;
  }
}
