-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))
) STORED;

-- CreateIndex
CREATE INDEX "journal_entry_search_vector_idx" ON "JournalEntry" USING gin("search_vector");
