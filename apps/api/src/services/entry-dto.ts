/** Row → wire mappers for entries, shared by the platform (CRUD) and intelligence (search) layers. */
import type { Attachment, Entry, EntrySummary, Mood } from '@solace/shared';
import type { attachments, entries } from '../db/schema';

type EntryRow = typeof entries.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;

const iso = (d: Date) => d.toISOString();

export function excerptOf(body: string, max = 220): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30))}…`;
}

export function toAttachment(row: AttachmentRow, url: string): Attachment {
  return {
    id: row.id,
    entryId: row.entryId,
    mime: row.mime,
    width: row.width,
    height: row.height,
    description: row.description,
    url,
    createdAt: iso(row.createdAt),
  };
}

function base(row: EntryRow) {
  return {
    id: row.id,
    title: row.title,
    entryDate: row.entryDate,
    mood: (row.mood as Mood | null) ?? null,
    moodSource: row.moodSource ?? null,
    tags: row.tags,
    summary: row.summary,
    wordCount: row.wordCount,
    version: row.version,
    enrichmentStatus: row.enrichmentStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toEntry(row: EntryRow, atts: Attachment[]): Entry {
  return { ...base(row), body: row.body, attachments: atts };
}

export function toEntrySummary(row: EntryRow, attachmentCount: number): EntrySummary {
  return { ...base(row), excerpt: excerptOf(row.body), attachmentCount };
}
