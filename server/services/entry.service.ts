import crypto from 'crypto';
import { EntryRepository } from '../repositories/entry.repository';
import { VectorRepository } from '../repositories/vector.repository';
import { ChunkRepository } from '../repositories/chunk.repository';
import { chunkText } from './chunker';
import { AIService } from './ai.service';
import { MemoryService } from './memory.service';
import { LongTermMemoryService } from './longterm-memory.service';
import { JournalEntry, ImageAsset } from '../db';
import { StorageService } from './storage.service';
import { GraphService } from './graph.service';

export class EntryService {
  private entryRepository = new EntryRepository();
  private vectorRepository = new VectorRepository();
  private chunkRepository = new ChunkRepository();
  private aiService = new AIService();
  private memoryService = new MemoryService();
  private storageService = new StorageService();
  private longTermMemoryService = new LongTermMemoryService();
  private graphService = new GraphService();

  public async getEntries(userId: string): Promise<JournalEntry[]> {
    return this.entryRepository.findAllByUserId(userId);
  }

  public async getEntry(id: string, userId: string): Promise<JournalEntry | null> {
    return this.entryRepository.findById(id, userId);
  }

  public async createEntry(
    userId: string,
    title: string,
    content: string,
    files?: Express.Multer.File[],
    apiKey?: string,
    customPrompt?: string
  ): Promise<JournalEntry> {
    if (!content.trim()) {
      throw new Error('Journal entry content cannot be empty.');
    }

    // 1. Core AI Analysis: Mood, Tags, Summary
    const analysis = await this.aiService.analyzeEntry(content, apiKey, customPrompt);

    // 2. Upload images, generate AI descriptions, and construct ImageAsset metadata records
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const images: ImageAsset[] = [];

    if (files && files.length > 0) {
      for (const file of files) {
        try {
          const imageUrl = await this.storageService.uploadFile(file);
          let description: string | undefined;
          try {
            description = await this.aiService.describeImage(file.buffer, file.mimetype, apiKey);
          } catch (descErr) {
            console.warn('Could not generate description for image, continuing without:', descErr);
          }
          images.push({
            id: crypto.randomUUID(),
            entryId,
            imageUrl,
            description,
            createdAt: now
          });
        } catch (uploadErr) {
          console.error('Failed to upload file to storage during entry creation:', uploadErr);
        }
      }
    }

    // 3. Build combined semantic document for embedding
    const semanticDoc = this.buildSemanticDocument(title, content, images);

    // 4. Generate Chunk-based Embeddings for RAG from combined document
    const chunks = chunkText(semanticDoc);
    const chunkEmbeddings: { content: string; vector: number[] }[] = [];
    for (const chunk of chunks) {
      try {
        const vectorText = `Title: ${title}\nChunk: ${chunk}`;
        const embedding = await this.aiService.generateEmbedding(vectorText, apiKey);
        chunkEmbeddings.push({ content: chunk, vector: embedding });
      } catch (err) {
        console.warn('Could not generate vector for chunk, skipping:', err);
      }
    }

    // 5. Persist Journal Entry along with Image relations
    const entry: JournalEntry = {
      id: entryId,
      userId,
      title: title.trim() || 'Untitled Entry',
      content: content.trim(),
      mood: analysis.mood || 'reflective',
      tags: analysis.tags || [],
      createdAt: now,
      updatedAt: now,
      images
    };

    const savedEntry = await this.entryRepository.create(entry);

    // 6. Persist Chunk embeddings linked to Entry
    for (let i = 0; i < chunkEmbeddings.length; i++) {
      const chunkData = chunkEmbeddings[i];
      await this.chunkRepository.saveChunk({
        id: crypto.randomUUID(),
        entryId: savedEntry.id,
        content: chunkData.content,
        chunkIndex: i,
        vector: chunkData.vector,
        createdAt: now
      });
    }

    // 7. Asynchronous Memory Processing
    this.memoryService.extractAndProcessMemories(userId, savedEntry.id, content, apiKey).catch(err => {
      console.error('Background memory processing failed:', err);
    });

    this.longTermMemoryService.extractAndProcess(userId, content, apiKey).catch(err => {
      console.error('Background long-term memory extraction failed:', err);
    });

    // 8. Asynchronous Graph Processing
    this.graphService.extractAndProcessGraph(userId, content, apiKey).catch(err => {
      console.error('Background graph processing failed:', err);
    });

    return savedEntry;
  }

  public async updateEntry(
    id: string,
    userId: string,
    title?: string,
    content?: string,
    files?: Express.Multer.File[],
    deletedImageIds?: string[],
    apiKey?: string,
    customPrompt?: string
  ): Promise<JournalEntry | null> {
    const existing = await this.entryRepository.findById(id, userId);
    if (!existing) return null;

    // 1. Process deletions of specified images
    if (deletedImageIds && deletedImageIds.length > 0) {
      for (const imageId of deletedImageIds) {
        const imageAsset = await this.entryRepository.findImageAssetById(imageId);
        if (imageAsset && imageAsset.entryId === id) {
          await this.storageService.deleteFile(imageAsset.imageUrl);
          await this.entryRepository.deleteImageAsset(imageId);
        }
      }
    }

    // 2. Process uploads of new images with AI descriptions
    if (files && files.length > 0) {
      const now = new Date().toISOString();
      for (const file of files) {
        try {
          const imageUrl = await this.storageService.uploadFile(file);
          let description: string | undefined;
          try {
            description = await this.aiService.describeImage(file.buffer, file.mimetype, apiKey);
          } catch (descErr) {
            console.warn('Could not generate description for new image on update:', descErr);
          }
          await this.entryRepository.createImageAsset({
            id: crypto.randomUUID(),
            entryId: id,
            imageUrl,
            description,
            createdAt: now
          });
        } catch (uploadErr) {
          console.error('Failed to upload file to storage during entry update:', uploadErr);
        }
      }
    }

    const updatedTitle = title !== undefined ? title.trim() : existing.title;
    const updatedContent = content !== undefined ? content.trim() : existing.content;

    const updateData: Partial<JournalEntry> = {
      title: updatedTitle,
      content: updatedContent
    };

    // Determine if we need to regenerate embeddings (content changed or images changed)
    const contentChanged = content !== undefined && content.trim() !== existing.content;
    const imagesChanged = (files && files.length > 0) || (deletedImageIds && deletedImageIds.length > 0);

    if (contentChanged) {
      const analysis = await this.aiService.analyzeEntry(updatedContent, apiKey, customPrompt);
      updateData.mood = analysis.mood;
      updateData.tags = analysis.tags;
    }

    // Regenerate chunk embeddings if content or images changed
    if (contentChanged || imagesChanged) {
      try {
        // Fetch the updated entry to get the latest image list with descriptions
        const refreshedEntry = await this.entryRepository.findById(id, userId);
        const currentImages = refreshedEntry?.images || [];

        // Build combined semantic document
        const semanticDoc = this.buildSemanticDocument(updatedTitle, updatedContent, currentImages);

        // Delete existing chunks first
        await this.chunkRepository.deleteChunksByEntryId(id);

        const chunks = chunkText(semanticDoc);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const vectorText = `Title: ${updatedTitle}\nChunk: ${chunk}`;
          const embedding = await this.aiService.generateEmbedding(vectorText, apiKey);
          await this.chunkRepository.saveChunk({
            id: crypto.randomUUID(),
            entryId: id,
            content: chunk,
            chunkIndex: i,
            vector: embedding,
            createdAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.warn('Could not regenerate chunk vectors on edit', err);
      }
    }

    if (contentChanged) {
      // Re-run memory extraction on updated content
      this.memoryService.extractAndProcessMemories(userId, id, updatedContent, apiKey).catch(err => {
        console.error('Background memory processing failed on update:', err);
      });

      this.longTermMemoryService.extractAndProcess(userId, updatedContent, apiKey).catch(err => {
        console.error('Background long-term memory extraction failed on update:', err);
      });

      // Re-run graph extraction on updated content
      this.graphService.extractAndProcessGraph(userId, updatedContent, apiKey).catch(err => {
        console.error('Background graph processing failed on update:', err);
      });
    }

    return this.entryRepository.update(id, userId, updateData);
  }

  public async deleteEntry(id: string, userId: string): Promise<boolean> {
    const entry = await this.entryRepository.findById(id, userId);
    if (!entry) return false;

    // 1. Delete physical image assets from storage
    if (entry.images && entry.images.length > 0) {
      for (const img of entry.images) {
        try {
          await this.storageService.deleteFile(img.imageUrl);
        } catch (storageErr) {
          console.error(`Failed to delete storage file ${img.imageUrl}:`, storageErr);
        }
      }
    }

    // 2. Delete database records
    const success = await this.entryRepository.delete(id, userId);
    if (success) {
      await this.vectorRepository.deleteVectorByEntryId(id);
      await this.chunkRepository.deleteChunksByEntryId(id);
    }
    return success;
  }

  public async searchEntries(userId: string, query: string, apiKey?: string): Promise<{ entry: JournalEntry; score: number }[]> {
    if (!query.trim()) {
      const entries = await this.getEntries(userId);
      return entries.map((e) => ({ entry: e, score: 1.0 }));
    }

    try {
      // 1. Generate query embedding vector (optional, fallback to null on failure)
      let queryVector: number[] | null = null;
      try {
        queryVector = await this.aiService.generateEmbedding(query, apiKey);
      } catch (embErr) {
        console.warn('Embedding generation failed during search, falling back to keyword-only hybrid mode:', embErr);
      }

      // 2. Perform Cosine Similarity against all user entry chunks (if vector was generated)
      let vectorResults: { entryId: string; score: number }[] = [];
      if (queryVector) {
        const topChunks = await this.chunkRepository.findTopSimilar(userId, queryVector, 30);
        
        // Deduplicate chunks to entries using adaptive threshold, keeping max score per entry
        const bestScore = topChunks[0]?.score || 0;
        const adaptiveThreshold = Math.max(0.4, bestScore * 0.8);

        const entryMaxScores = new Map<string, number>();
        for (const match of topChunks) {
          if (match.score >= adaptiveThreshold) {
            const existing = entryMaxScores.get(match.entryId) ?? 0;
            if (match.score > existing) {
              entryMaxScores.set(match.entryId, match.score);
            }
          }
        }

        vectorResults = Array.from(entryMaxScores.entries()).map(([entryId, score]) => ({
          entryId,
          score
        }));
      }

      // 3. Perform Keyword search
      const keywordResults = await this.entryRepository.searchKeyword(userId, query, 20);

      // 4. Normalize keyword ranks to [0, 1]
      const maxRank = Math.max(...keywordResults.map((r) => r.rank), 0);
      const keywordScores = new Map<string, number>();
      for (const match of keywordResults) {
        const score = maxRank > 0 ? match.rank / maxRank : 0;
        keywordScores.set(match.entryId, score);
      }

      // Deduplicate vector matches and record max score per entry
      const semanticScores = new Map<string, number>();
      for (const match of vectorResults) {
        const existing = semanticScores.get(match.entryId) ?? 0;
        if (match.score > existing) {
          semanticScores.set(match.entryId, match.score);
        }
      }

      // 5. Merge results using formula: 0.7 * Semantic Score + 0.3 * Keyword Score
      const entryIds = new Set([...semanticScores.keys(), ...keywordScores.keys()]);
      const mergedResults: { entryId: string; score: number }[] = [];
      for (const entryId of entryIds) {
        const semanticScore = semanticScores.get(entryId) ?? 0;
        const keywordScore = keywordScores.get(entryId) ?? 0;
        const finalScore = 0.7 * semanticScore + 0.3 * keywordScore;
        mergedResults.push({ entryId, score: finalScore });
      }

      // 6. Sort by final score descending and take top 10
      const sortedMatches = mergedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      // 7. Fetch full entry details for each match
      const results: { entry: JournalEntry; score: number }[] = [];
      for (const match of sortedMatches) {
        const entry = await this.entryRepository.findById(match.entryId, userId);
        if (entry) {
          results.push({ entry, score: match.score });
        }
      }

      return results;
    } catch (err) {
      console.error('Hybrid search failed, falling back to clean keyword search on all entries:', err);
      // Fallback simple keyword search on all user entries
      const entries = await this.getEntries(userId);
      const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (keywords.length === 0) {
        return entries.map((e) => ({ entry: e, score: 0 }));
      }
      return entries
        .map((entry) => {
          let score = 0;
          const fullText = (entry.title + ' ' + entry.content).toLowerCase();
          for (const kw of keywords) {
            if (fullText.includes(kw)) score += 0.25;
          }
          return { entry, score };
        })
        .filter((res) => res.score > 0)
        .sort((a, b) => b.score - a.score);
    }
  }

  private buildSemanticDocument(title: string, content: string, images: ImageAsset[]): string {
    const parts: string[] = [];

    parts.push(`Title: ${title.trim() || 'Untitled Entry'}`);
    parts.push('');
    parts.push(`Journal Content:\n${content.trim()}`);

    const descriptions = images
      .map((img) => img.description)
      .filter((d): d is string => !!d && d.trim().length > 0);

    if (descriptions.length > 0) {
      parts.push('');
      parts.push(`Image Context:\n${descriptions.join('\n')}`);
    }

    return parts.join('\n');
  }
}
