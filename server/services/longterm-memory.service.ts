import { LongTermMemoryRepository } from '../repositories/longterm-memory.repository';
import { AIService } from './ai.service';

export class LongTermMemoryService {
  private longTermMemoryRepository = new LongTermMemoryRepository();
  private aiService = new AIService();

  public async getMemories(userId: string) {
    return this.longTermMemoryRepository.findAllByUserId(userId);
  }

  public async searchMemories(userId: string, query: string, topK = 5) {
    const queryVector = await this.aiService.generateEmbedding(query);
    return this.longTermMemoryRepository.findTopSimilar(userId, queryVector, topK);
  }

  public async extractAndProcess(
    userId: string,
    entryContent: string,
    apiKey?: string
  ): Promise<void> {
    try {
      const activeMemories = await this.longTermMemoryRepository.findAllByUserId(userId);
      const activeMemoriesText = activeMemories
        .map((m) => `- [ID: ${m.id}] ${m.content} (Confidence: ${m.confidence})`)
        .join('\n');

      const ai = this.aiService['getAI'] ? (this.aiService as any).getAI(apiKey) : (require('./ai.service').getAI)(apiKey);

      const prompt = `You are a cognitive memory system architect. Your goal is to extract, update, or deduplicate durable memories about the user from a new journal entry.
Memories are concise, declarative facts, preferences, values, traits, or attributes about the user (e.g. "User enjoys Formula 1", "User watches races every weekend"). They MUST be written in the third person starting with "User...".

Existing Memories:
${activeMemoriesText || 'None'}

New Journal Entry:
${entryContent}

Analyze the new entry to:
1. Extract new memories. For each new memory, assign a confidence score between 0.0 and 1.0. Keep them concise and general.
2. Detect updates/deduplications for existing memories. If the entry reinforces, refines, or updates an existing memory, update its content or confidence.
3. Identify memories that should be deleted if they are directly contradicted by the new entry.

Respond STRICTLY in JSON format matching this schema, without any markdown formatting block around it:
{
  "newMemories": [
    { "content": "string (third-person declarative fact)", "confidence": number }
  ],
  "updateMemories": [
    { "id": "string", "content": "string (updated third-person fact)", "confidence": number }
  ],
  "deleteMemories": [
    { "id": "string", "reason": "string" }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      let text = response.text?.trim() || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }
      
      const result = JSON.parse(text);

      // 1. Process deletions
      for (const del of result.deleteMemories || []) {
        await this.longTermMemoryRepository.delete(del.id);
      }

      // 2. Process updates
      for (const update of result.updateMemories || []) {
        const vector = await this.aiService.generateEmbedding(update.content, apiKey);
        await this.longTermMemoryRepository.update(update.id, update.content, update.confidence, vector);
      }

      // 3. Process new memories
      for (const mem of result.newMemories || []) {
        const vector = await this.aiService.generateEmbedding(mem.content, apiKey);
        await this.longTermMemoryRepository.create(userId, mem.content, mem.confidence, vector);
      }
    } catch (err) {
      console.error('[LongTermMemoryService] Memory extraction failed:', err);
    }
  }
}
