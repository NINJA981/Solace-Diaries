import { prisma, shouldUseMock } from '../db.client';
import { JournalEntry, ImageAsset, Database } from '../db';

export class EntryRepository {
  async findAllByUserId(userId: string): Promise<JournalEntry[]> {
    if (shouldUseMock()) {
      const entries = Database.getEntries().filter((e) => e.userId === userId);
      const images = Database.getImageAssets();
      return entries
        .map((e) => ({
          ...e,
          images: images.filter((img) => img.entryId === e.id)
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    const entries = await prisma.journalEntry.findMany({
      where: { userId },
      include: { images: true },
      orderBy: { createdAt: 'desc' }
    });
    return entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      images: e.images.map((img) => ({
        ...img,
        createdAt: img.createdAt.toISOString()
      }))
    }));
  }

  async findById(id: string, userId: string): Promise<JournalEntry | null> {
    if (shouldUseMock()) {
      const entry = Database.getEntries().find((e) => e.id === id && e.userId === userId);
      if (!entry) return null;
      const images = Database.getImageAssets().filter((img) => img.entryId === entry.id);
      return { ...entry, images };
    }
    const entry = await prisma.journalEntry.findFirst({
      where: { id, userId },
      include: { images: true }
    });
    if (!entry) return null;
    return {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      images: entry.images.map((img) => ({
        ...img,
        createdAt: img.createdAt.toISOString()
      }))
    };
  }

  async create(entry: JournalEntry): Promise<JournalEntry> {
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      entries.push(entry);
      Database.saveEntries(entries);
      if (entry.images && entry.images.length > 0) {
        const imageAssets = Database.getImageAssets();
        imageAssets.push(...entry.images);
        Database.saveImageAssets(imageAssets);
      }
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
        updatedAt: new Date(entry.updatedAt),
        images: entry.images
          ? {
              create: entry.images.map((img) => ({
                id: img.id,
                imageUrl: img.imageUrl,
                description: img.description ?? null,
                createdAt: new Date(img.createdAt)
              }))
            }
          : undefined
      },
      include: { images: true }
    });
    return {
      ...created,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      images: created.images.map((img) => ({
        ...img,
        createdAt: img.createdAt.toISOString()
      }))
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
      
      const images = Database.getImageAssets().filter((img) => img.entryId === id);
      return { ...updatedEntry, images };
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
      },
      include: { images: true }
    });
    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      images: updated.images.map((img) => ({
        ...img,
        createdAt: img.createdAt.toISOString()
      }))
    };
  }

  async delete(id: string, userId: string): Promise<boolean> {
    if (shouldUseMock()) {
      const entries = Database.getEntries();
      const origLen = entries.length;
      const filtered = entries.filter((e) => !(e.id === id && e.userId === userId));
      if (filtered.length === origLen) return false;
      Database.saveEntries(filtered);

      // Cascade delete image assets in mock mode
      const imageAssets = Database.getImageAssets();
      const remainingImages = imageAssets.filter((img) => img.entryId !== id);
      Database.saveImageAssets(remainingImages);
      return true;
    }
    const existing = await prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!existing) return false;

    await prisma.journalEntry.delete({
      where: { id }
    });
    return true;
  }

  // --- IMAGE ASSET UTILITY OPERATIONS ---

  async createImageAsset(image: ImageAsset): Promise<ImageAsset> {
    if (shouldUseMock()) {
      const imageAssets = Database.getImageAssets();
      imageAssets.push(image);
      Database.saveImageAssets(imageAssets);
      return image;
    }
    const created = await prisma.imageAsset.create({
      data: {
        id: image.id,
        entryId: image.entryId,
        imageUrl: image.imageUrl,
        description: image.description ?? null,
        createdAt: new Date(image.createdAt)
      }
    });
    return {
      ...created,
      createdAt: created.createdAt.toISOString()
    };
  }

  async deleteImageAsset(id: string): Promise<boolean> {
    if (shouldUseMock()) {
      const imageAssets = Database.getImageAssets();
      const origLen = imageAssets.length;
      const filtered = imageAssets.filter((img) => img.id !== id);
      if (filtered.length === origLen) return false;
      Database.saveImageAssets(filtered);
      return true;
    }
    const existing = await prisma.imageAsset.findUnique({ where: { id } });
    if (!existing) return false;
    await prisma.imageAsset.delete({ where: { id } });
    return true;
  }

  async findImageAssetById(id: string): Promise<ImageAsset | null> {
    if (shouldUseMock()) {
      const assets = Database.getImageAssets();
      return assets.find((img) => img.id === id) || null;
    }
    const asset = await prisma.imageAsset.findUnique({
      where: { id }
    });
    if (!asset) return null;
    return {
      ...asset,
      createdAt: asset.createdAt.toISOString()
    };
  }

  async searchKeyword(userId: string, queryText: string, topK = 20): Promise<{ entryId: string; rank: number }[]> {
    if (!queryText.trim()) return [];

    if (shouldUseMock()) {
      const entries = Database.getEntries().filter((e) => e.userId === userId);
      const keywords = queryText.toLowerCase().split(/\s+/).filter(Boolean);
      if (keywords.length === 0) return [];

      const results = entries
        .map((entry) => {
          let rank = 0;
          const titleText = entry.title.toLowerCase();
          const contentText = entry.content.toLowerCase();
          for (const kw of keywords) {
            if (titleText.includes(kw)) rank += 2.0;
            if (contentText.includes(kw)) rank += 1.0;
          }
          return { entryId: entry.id, rank };
        })
        .filter((r) => r.rank > 0);

      return results.sort((a, b) => b.rank - a.rank).slice(0, topK);
    }

    const results = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
      SELECT id, ts_rank(search_vector, plainto_tsquery('english', ${queryText})) as rank
      FROM "JournalEntry"
      WHERE "userId" = ${userId} AND search_vector @@ plainto_tsquery('english', ${queryText})
      ORDER BY rank DESC
      LIMIT ${topK}
    `;

    return results.map((r) => ({
      entryId: r.id,
      rank: Number(r.rank)
    }));
  }
}
