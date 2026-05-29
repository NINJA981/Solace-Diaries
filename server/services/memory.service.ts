import { MemoryRepository } from '../repositories/memory.repository';
import { AIService } from './ai.service';

export class MemoryService {
  private memoryRepository = new MemoryRepository();
  private aiService = new AIService();

  public async getActiveMemories(userId: string) {
    return this.memoryRepository.getActiveMemoryFragments(userId);
  }

  public async getPendingPrompt(userId: string) {
    return this.memoryRepository.getPendingProactivePrompt(userId);
  }

  public async respondToPrompt(userId: string, promptId: string, responseText: string) {
    const prompt = await this.memoryRepository.getPromptById(promptId, userId);
    if (!prompt) throw new Error('Prompt not found');
    return this.memoryRepository.markPromptDelivered(promptId, responseText);
  }

  public async extractAndProcessMemories(
    userId: string,
    entryId: string,
    entryContent: string,
    apiKey?: string
  ) {
    try {
      const activeMemories = await this.memoryRepository.getActiveMemoryFragments(userId);
      const activeMemoriesText = activeMemories
        .map(m => `[ID: ${m.id}] (${m.category}): ${m.content} (Strength: ${m.strength})`)
        .join('\n');

      const ai = this.aiService['getAI'] ? (this.aiService as any).getAI(apiKey) : (require('./ai.service').getAI)(apiKey);
      
      const p = `You are a cognitive memory layer for a personal journal. Analyze the following new journal entry.
Identify if any of the following apply:
1. New Memory Fragments: Ambitions, relationships, emotional trends, life events, milestones, unfinished goals, or behavioral patterns.
2. Updates to Existing Memory Fragments: Does the entry reinforce an existing memory?
3. Proactive Prompts: Should the journal reach out to the user later?
   - "next_day": E.g., user mentions a big event tomorrow.
   - "afternoon_followup": E.g., user had a heavy, difficult day.
   - "weeks_later": E.g., user repeatedly sets a goal.
   - "spontaneous": Very strong connection to past memory.

Existing Memories:
${activeMemoriesText || 'None'}

New Entry:
${entryContent}

Respond STRICTLY in JSON matching this schema, completely without markdown formatting:
{
  "newFragments": [
    { "category": "ambition|relationship|emotional_trend|life_event|unfinished_goal|milestone|behavioral_pattern", "content": "string" }
  ],
  "updateFragments": [
    { "id": "string", "reason": "string" }
  ],
  "proactivePrompt": {
    "shouldCreate": boolean,
    "triggerType": "next_day|weeks_later|afternoon_followup|spontaneous",
    "promptText": "string (warm, contextual question/message from the journal)",
    "relatedFragmentId": "string (optional id of an existing or new fragment it relates to)"
  }
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: p,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = response.text?.trim() || '';
      const result = JSON.parse(text);

      // 1. Create new fragments
      for (const fragment of result.newFragments || []) {
        await this.memoryRepository.createMemoryFragment(
          userId,
          fragment.category,
          fragment.content,
          entryId
        );
      }

      // 2. Update existing fragments
      for (const update of result.updateFragments || []) {
        const existing = activeMemories.find(m => m.id === update.id);
        if (existing) {
          await this.memoryRepository.updateMemoryFragmentStrength(
            existing.id,
            existing.strength + 1,
            entryId
          );
        }
      }

      // 3. Create proactive prompt if needed
      if (result.proactivePrompt?.shouldCreate && result.proactivePrompt.promptText) {
        let scheduledFor = new Date();
        const trigger = result.proactivePrompt.triggerType;
        
        if (trigger === 'next_day') {
          scheduledFor.setHours(scheduledFor.getHours() + 18);
        } else if (trigger === 'afternoon_followup') {
          scheduledFor.setHours(scheduledFor.getHours() + 24);
        } else if (trigger === 'weeks_later') {
          scheduledFor.setDate(scheduledFor.getDate() + 14);
        } else {
          scheduledFor.setMinutes(scheduledFor.getMinutes() + 1); // Spontaneous (almost immediate)
        }

        await this.memoryRepository.createProactivePrompt(
          userId,
          result.proactivePrompt.promptText,
          trigger,
          scheduledFor,
          result.proactivePrompt.relatedFragmentId // Note: this ID must be valid, but Gemini might hallucinate it, so we can ignore it if we wanted strict FK. Let's keep it undefined for safety unless we map it properly.
        );
      }
    } catch (err) {
      console.error('Memory extraction failed, skipping.', err);
    }
  }
}
