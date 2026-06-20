-- CreateTable
CREATE TABLE "JournalChunk" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vector" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalChunk_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JournalChunk" ADD CONSTRAINT "JournalChunk_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
