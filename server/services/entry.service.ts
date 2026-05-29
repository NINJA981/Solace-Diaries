import crypto from 'crypto';
import { EntryRepository } from '../repositories/entry.repository';
import { VectorRepository } from '../repositories/vector.repository';
import { AIService } from './ai.service';
import { MemoryService } from './memory.service';
import { JournalEntry } from '../db';

export class EntryService {
  private entryRepository = new EntryRepository();
  private vectorRepository = new VectorRepository();
  private aiService = new AIService();
  private memoryService = new MemoryService();

  public async getEntries(userId: string): Promise<JournalEntry[]> {
    return this.entryRepository.findAllByUserId(userId);
  }

  public async getEntry(id: string, userId: string): Promise<JournalEntry | null> {
    return this.entryRepository.findById(id, userId);
  }

  public async createEntry(userId: string, title: string, content: string, apiKey?: string, customPrompt?: string): Promise<JournalEntry> {
    if (!content.trim()) {
      throw new Error('Journal entry content cannot be empty.');
    }

    // 1. Core AI Analysis: Mood, Tags, Summary
    const analysis = await this.aiService.analyzeEntry(content, apiKey, customPrompt);

    // 2. Generate Embedding Vector for RAG and Semantic Memory Search
    let vector: number[] = [];
    try {
      // We can generate embedding for the title + content mix so both search types match
      const vectorText = `Title: ${title}\nContent: ${content}`;
      vector = await this.aiService.generateEmbedding(vectorText, apiKey);
    } catch (err) {
      console.warn('Could not generate vector for entry, setting empty vector cache', err);
    }

    // 3. Persist Journal Entry
    const now = new Date().toISOString();
    const entryId = crypto.randomUUID();
    const entry: JournalEntry = {
      id: entryId,
      userId,
      title: title.trim() || 'Untitled Entry',
      content: content.trim(),
      mood: analysis.mood || 'reflective',
      tags: analysis.tags || [],
      createdAt: now,
      updatedAt: now
    };

    const savedEntry = await this.entryRepository.create(entry);

    // 4. Persist Vector embedding linked to Entry
    if (vector.length > 0) {
      await this.vectorRepository.saveVector({
        id: crypto.randomUUID(),
        entryId: savedEntry.id,
        userId,
        vector,
        createdAt: now
      });
    }

    // 5. Asynchronous Memory Processing
    this.memoryService.extractAndProcessMemories(userId, savedEntry.id, content, apiKey).catch(err => {
      console.error('Background memory processing failed:', err);
    });

    return savedEntry;
  }

  public async updateEntry(id: string, userId: string, title?: string, content?: string, apiKey?: string, customPrompt?: string): Promise<JournalEntry | null> {
    const existing = await this.entryRepository.findById(id, userId);
    if (!existing) return null;

    const updatedTitle = title !== undefined ? title.trim() : existing.title;
    const updatedContent = content !== undefined ? content.trim() : existing.content;

    const updateData: Partial<JournalEntry> = {
      title: updatedTitle,
      content: updatedContent
    };

    // If content actually changed, re-run AI analysis and generate new vector
    if (content !== undefined && content.trim() !== existing.content) {
      const analysis = await this.aiService.analyzeEntry(updatedContent, apiKey, customPrompt);
      updateData.mood = analysis.mood;
      updateData.tags = analysis.tags;

      try {
        const vectorText = `Title: ${updatedTitle}\nContent: ${updatedContent}`;
        const vector = await this.aiService.generateEmbedding(vectorText, apiKey);
        await this.vectorRepository.saveVector({
          id: crypto.randomUUID(),
          entryId: id,
          userId,
          vector,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn('Could not regenerate vector on edit', err);
      }
      
      // Re-run memory extraction on updated content
      this.memoryService.extractAndProcessMemories(userId, id, updatedContent, apiKey).catch(err => {
        console.error('Background memory processing failed on update:', err);
      });
    }

    return this.entryRepository.update(id, userId, updateData);
  }

  public async deleteEntry(id: string, userId: string): Promise<boolean> {
    const success = await this.entryRepository.delete(id, userId);
    if (success) {
      await this.vectorRepository.deleteVectorByEntryId(id);
    }
    return success;
  }

  public async searchEntries(userId: string, query: string, apiKey?: string): Promise<{ entry: JournalEntry; score: number }[]> {
    if (!query.trim()) {
      const entries = await this.getEntries(userId);
      return entries.map((e) => ({ entry: e, score: 1.0 }));
    }

    try {
      // 1. Generate query embedding vector
      const queryVector = await this.aiService.generateEmbedding(query, apiKey);

      // 2. Perform Cosine Similarity against all user entries
      const topMatches = await this.vectorRepository.findTopSimilar(userId, queryVector, 10);

      // 3. Fetch full entry details for each similarity match
      const results: { entry: JournalEntry; score: number }[] = [];
      for (const match of topMatches) {
        // Skip match scoring lower than a low threshold if we want, or raw scores
        const entry = await this.entryRepository.findById(match.entryId, userId);
        if (entry) {
          results.push({ entry, score: match.score });
        }
      }

      // Fallback keyword match if embedding retrieval returns empty
      if (results.length === 0) {
        const entries = await this.getEntries(userId);
        const keywords = query.toLowerCase().split(/\s+/);
        const fallbackResults = entries
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

        return fallbackResults;
      }

      return results;
    } catch (err) {
      console.error('Semantic search failed, falling back to keyword search:', err);
      // Fallback keyword search
      const entries = await this.getEntries(userId);
      const keywords = query.toLowerCase().split(/\s+/);
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
}
