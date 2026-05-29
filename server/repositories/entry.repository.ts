import { prisma, shouldUseMock } from '../db.client';
import { JournalEntry, Database } from '../db';

export class EntryRepository {
  async findAllByUserId(userId: string): Promise<JournalEntry[]> {
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      return entries
        .filter((e) => e.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
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
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      return entries.find((e) => e.id === id && e.userId === userId) || null;
    }
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
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      entries.push(entry);
      Database.saveEntries(entries);
      return entry;
    }
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
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      const idx = entries.findIndex((e) => e.id === id && e.userId === userId);
      if (idx === -1) return null;
      const updatedEntry: JournalEntry = {
        ...entries[idx],
        ...update,
        updatedAt: new Date().toISOString()
      };
      entries[idx] = updatedEntry;
      Database.saveEntries(entries);
      return updatedEntry;
    }
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
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      const origLen = entries.length;
      const filtered = entries.filter((e) => !(e.id === id && e.userId === userId));
      if (filtered.length === origLen) return false;
      Database.saveEntries(filtered);
      return true;
    }
    const existing = await prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!existing) return false;

    await prisma.journalEntry.delete({
      where: { id }
    });
    return true;
  }
}
