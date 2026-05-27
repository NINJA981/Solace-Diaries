import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;

export function getAI(customApiKey?: string): GoogleGenAI {
  if (customApiKey) {
    return new GoogleGenAI({
      apiKey: customApiKey
    });
  }
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not defined. Please add it to your project Secrets.'
      );
    }
    aiInstance = new GoogleGenAI({
      apiKey
    });
  }
  return aiInstance;
}

export class AIService {
  public async generateEmbedding(text: string, apiKey?: string): Promise<number[]> {
    try {
      const ai = getAI(apiKey);
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: text
      });

      const embeddingValues = response.embeddings?.[0]?.values;
      if (!embeddingValues) {
        throw new Error('Vector model returned an empty embedding response.');
      }
      return embeddingValues;
    } catch (err: any) {
      console.error('Embedding generation failed:', err);
      // Fallback deterministic pseudo-random embedding vector of 768 dimensions in case model is temporarily rate limited
      // so mock doesn't break the flow completely, but throw error in real usage if desired.
      // Let's throw the real error but logs it clearly
      throw new Error(`AI Embedding failure: ${err.message || err}`);
    }
  }

  public async analyzeEntry(content: string, apiKey?: string): Promise<{ mood: string; tags: string[]; summary: string }> {
    try {
      const ai = getAI(apiKey);
      const p = `Analyze the journal entry below. Extract the primary mood (as a single lowercase word, e.g., "joyful", "reflective", "anxious", "sad", "unfocused", "energetic", "peaceful", "tired"), 2-4 search-friendly metadata tags, and a highly polished 2-sentence summary.
      
Format your response strictly as a JSON object matching this schema, completely without markdown formatting:
{
  "mood": "string",
  "tags": ["string"],
  "summary": "string"
}

Journal entry content:
${content}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: p,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = response.text?.trim() || '';
      return JSON.parse(text);
    } catch (err: any) {
      console.error('Entry analysis failed, returning smart defaults:', err);
      return {
        mood: 'reflective',
        tags: ['journal', 'memory'],
        summary: content.slice(0, 100) + '...'
      };
    }
  }

  public async getWeeklySummary(entriesText: string, apiKey?: string): Promise<string> {
    try {
      const ai = getAI(apiKey);
      const p = `The following are the user's journal entries from the past week. Synthesize them to provide deep psychological and personal growth insights. Find patterns in their feelings, focus topics, work/life balance, and general mental health themes. Provide 3 direct, action-oriented, and encouraging suggestions. Write in clean, beautiful Markdown text. Keep it empathetic and insightful.
      
Entries:
${entriesText}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: p
      });

      return response.text || 'Not enough entry data to generate a weekly summary.';
    } catch (err: any) {
      return `### Peak Insights\nFailed to generate insights: ${err.message || err}`;
    }
  }

  public async retrieveAndAnswer(question: string, contextEntries: { title: string; date: string; content: string }[], apiKey?: string): Promise<string> {
    try {
      const ai = getAI(apiKey);
      const contextText = contextEntries
        .map((e, i) => `[Entry #${i + 1}] Date: ${e.date} | Title: ${e.title}\nContent: ${e.content}`)
        .join('\n\n');

      const p = `You are a warm, highly intuitive, and loving Reflection Guide for "Haven Journal". A user is asking a question about their memories or past journal entries. Using ONLY the provided context entries from their past, answer their query with deep emotional alignment, gentle guidance, and accurate retrieval of details. Always cite the dates of the entries you are referencing.
      
If the provided entries do not contain the answer, say so gently, but try to find any relevant themes or moods from those days to offer warm solace.
Do not make up facts or reveal details from outside the entries.

Context Entries from Past:
${contextText}

User's Question:
"${question}"`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: p
      });

      return response.text || 'I was unable to search your entries at this time.';
    } catch (err: any) {
      return `Failed to answer: ${err.message || err}`;
    }
  }
}
