import { AIService } from './ai.service';
import { EntryRepository } from '../repositories/entry.repository';
import { ChunkRepository } from '../repositories/chunk.repository';
import { ContextCompressionService } from './compression.service';
import { GraphRepository } from '../repositories/graph.repository';
import { LongTermMemoryRepository } from '../repositories/longterm-memory.repository';

export class ChatService {
  private aiService = new AIService();
  private entryRepository = new EntryRepository();
  private chunkRepository = new ChunkRepository();
  private compressionService = new ContextCompressionService();
  private graphRepository = new GraphRepository();
  private longTermMemoryRepository = new LongTermMemoryRepository();

  public async askPastEntries(userId: string, question: string, apiKey?: string, customPrompt?: string): Promise<{ answer: string; sources: { id: string; title: string; date: string }[] }> {
    if (!question.trim()) {
      throw new Error('Question content cannot be empty.');
    }

    let sources: { id: string; title: string; date: string }[] = [];
    let relevantEntries: { title: string; date: string; content: string }[] = [];
    let relevantMemories: { content: string; confidence: number }[] = [];

    try {
      // 1. Generate query embedding
      const queryVector = await this.aiService.generateEmbedding(question, apiKey);

      // 2. Fetch top 10 matched historical chunks
      const topChunks = await this.chunkRepository.findTopSimilar(userId, queryVector, 10);

      // 2.1 Fetch top 5 matched long-term memories
      const topMemories = await this.longTermMemoryRepository.findTopSimilar(userId, queryVector, 5);
      relevantMemories = topMemories
        .filter(m => m.score >= 0.4)
        .map(m => ({ content: m.content, confidence: m.confidence }));

      // 3. Resolve matched chunks and construct LLM context using adaptive threshold
      const bestScore = topChunks[0]?.score || 0;
      const adaptiveThreshold = Math.max(0.4, bestScore * 0.8);

      for (const match of topChunks) {
        if (match.score >= adaptiveThreshold) {
          const entry = await this.entryRepository.findById(match.entryId, userId);
          if (entry) {
            if (!sources.some((s) => s.id === entry.id)) {
              sources.push({
                id: entry.id,
                title: entry.title,
                date: new Date(entry.createdAt).toLocaleDateString()
              });
            }
            relevantEntries.push({
              title: `${entry.title} (Part ${match.chunkIndex + 1})`,
              date: entry.createdAt,
              content: match.content
            });
          }
        }
      }
    } catch (err) {
      console.warn('RAG embedding extraction failed, falling back to static lookups...', err);
    }

    // If no vector match found or vector service failed, retrieve the 10 most recent entries as general contextual background
    if (relevantEntries.length === 0) {
      const recent = (await this.entryRepository.findAllByUserId(userId)).slice(0, 10);
      for (const entry of recent) {
        sources.push({
          id: entry.id,
          title: entry.title,
          date: new Date(entry.createdAt).toLocaleDateString()
        });
        relevantEntries.push({
          title: entry.title,
          date: entry.createdAt,
          content: entry.content
        });
      }
    }

    // 4. Compress retrieved context to reduce token usage by 60-80%
    let finalEntries = relevantEntries;
    try {
      const compressed = await this.compressionService.compress(question, relevantEntries, apiKey);
      finalEntries = compressed.entries;
    } catch (err) {
      console.warn('Context compression failed, falling back to original entries:', err);
    }

    // 4.5. Retrieve Graph Context matching the question or retrieved content
    let graphContextText = '';
    try {
      const entities = await this.graphRepository.getEntities(userId);
      const cleanQuestion = question.toLowerCase();
      
      const matchedEntities = entities.filter(e => {
        const nameLower = e.name.toLowerCase();
        if (cleanQuestion.includes(nameLower)) return true;
        return finalEntries.some(fe => fe.content.toLowerCase().includes(nameLower));
      });

      if (matchedEntities.length > 0) {
        const relationships = await this.graphRepository.getRelationships(userId);
        const matchedRelStrings: string[] = [];

        for (const r of relationships) {
          const source = entities.find(e => e.id === r.sourceId);
          const target = entities.find(e => e.id === r.targetId);
          if (source && target) {
            const sourceMatched = matchedEntities.some(me => me.id === source.id);
            const targetMatched = matchedEntities.some(me => me.id === target.id);
            if (sourceMatched || targetMatched) {
              matchedRelStrings.push(`- ${source.name} (${source.type}) ${r.type} ${target.name} (${target.type}) [Strength: ${r.strength}]`);
            }
          }
        }

        if (matchedRelStrings.length > 0) {
          graphContextText = `Highly relevant behavioral triggers and psychological connections found in the user's reflection graph:\n${matchedRelStrings.join('\n')}`;
        }
      }
    } catch (graphErr) {
      console.warn('Failed to retrieve graph context for chat RAG:', graphErr);
    }

    if (graphContextText) {
      finalEntries.push({
        title: 'Structured Reflection Graph Connections',
        date: 'Constellation Data',
        content: graphContextText
      });
    }

    // 5. Call AIService to retrieve exact facts and answer empathetic guidelines
    const answer = await this.aiService.retrieveAndAnswer(question, finalEntries, apiKey, customPrompt, relevantMemories, true);

    return {
      answer,
      sources
    };
  }
}

