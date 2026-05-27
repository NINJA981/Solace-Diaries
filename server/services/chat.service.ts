import { AIService } from './ai.service';
import { EntryRepository } from '../repositories/entry.repository';
import { VectorRepository } from '../repositories/vector.repository';

export class ChatService {
  private aiService = new AIService();
  private entryRepository = new EntryRepository();
  private vectorRepository = new VectorRepository();

  public async askPastEntries(userId: string, question: string, apiKey?: string, customPrompt?: string): Promise<{ answer: string; sources: { id: string; title: string; date: string }[] }> {
    if (!question.trim()) {
      throw new Error('Question content cannot be empty.');
    }

    let sources: { id: string; title: string; date: string }[] = [];
    let relevantEntries: { title: string; date: string; content: string }[] = [];

    try {
      // 1. Generate query embedding
      const queryVector = await this.aiService.generateEmbedding(question, apiKey);

      // 2. Fetch top 4 matched historical segments
      const topSimilar = await this.vectorRepository.findTopSimilar(userId, queryVector, 4);

      // 3. Resolve matched entity models
      for (const match of topSimilar) {
        if (match.score > 0.4) { // Only keep moderately relevant ones for high quality RAG
          const entry = await this.entryRepository.findById(match.entryId, userId);
          if (entry) {
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
      }
    } catch (err) {
      console.warn('RAG embedding extraction failed, falling back to static lookups...', err);
    }

    // If no vector match found or vector service failed, retrieve the 4 most recent entries as general contextual background
    if (relevantEntries.length === 0) {
      const recent = (await this.entryRepository.findAllByUserId(userId)).slice(0, 4);
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

    // 4. Call AIService to retrieve exact facts and answer empathetic guidelines
    const answer = await this.aiService.retrieveAndAnswer(question, relevantEntries, apiKey, customPrompt);

    return {
      answer,
      sources
    };
  }
}
