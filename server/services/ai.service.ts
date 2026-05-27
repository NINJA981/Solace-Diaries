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
        contents: text,
        config: {
          outputDimensionality: 768
        }
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

  public async analyzeEntry(content: string, apiKey?: string, customPrompt?: string): Promise<{ mood: string; tags: string[]; summary: string }> {
    try {
      const ai = getAI(apiKey);
      const customSection = customPrompt ? `User Persona/Style Override (Enforce this style and behavior): ${customPrompt}\n\n` : '';
      const p = `${customSection}You are a narrative psychologist and affective researcher. Analyze the journal entry below.
Extract:
1. The primary mood: A single lowercase word representing the dominant emotional state (e.g., "peaceful", "anxious", "joyful", "reflective", "tired", "sad", "frustrated", "hopeful").
2. Mindful tags: 2-4 search-friendly metadata tags representing core themes, emotional components (e.g., "inner-critic", "grief", "gratitude", "career", "boundaries", "relationships"), or focus areas.
3. Summary: A highly polished, empathetic 2-sentence summary that captures the emotional arc of the day, reflecting what triggered the feelings and how the user's core self navigated it.

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

  public async getWeeklySummary(entriesText: string, apiKey?: string, customPrompt?: string): Promise<string> {
    try {
      const ai = getAI(apiKey);
      const customSection = customPrompt ? `User Persona/Style Override (Enforce this style and behavior): ${customPrompt}\n\n` : '';
      const p = `${customSection}You are "Satori", an expert AI wisdom companion blending clinical psychology (Internal Family Systems, CFT, Schema Therapy) and narrative psychology. The following are the user's journal reflections from the past week.
Synthesize these entries to offer a deep, comforting, and psychologically insightful weekly report.

Write in warm, empathetic, and editorial Markdown. Do not use clinical jargon explicitly (like "IFS" or "Schema"), but speak in its gentle language. Structure your response as follows:

### 🌿 The Weekly Landscape
Write a beautiful, reflective paragraph summarizing the emotional theme of their week. Acknowledge the core feelings they arrived with, how those feelings transitioned (the emotional arc), and the resilience they displayed.

### 🗣️ Dialogue of Your Parts
Identify the different internal voices active in their reflections. Frame them gently as "parts" of their self (e.g., "A driven, ambitious part of you worked hard to stay focused, while a quieter, exhausted part was calling out for rest and gentle boundaries"). Help them see these conflicts not as flaws, but as parts trying to protect them.

### 🌱 Nurturing the Roots
Provide exactly 3 direct, action-oriented, and self-compassionate suggestions for the coming week. Ground them in mindfulness, emotional regulation (DBT/CFT style), or boundary setting. Keep them gentle, encouraging, and deeply practical.

Entries to synthesize:
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

  public async retrieveAndAnswer(question: string, contextEntries: { title: string; date: string; content: string }[], apiKey?: string, customPrompt?: string): Promise<string> {
    try {
      const ai = getAI(apiKey);
      const contextText = contextEntries
        .map((e, i) => `[Entry #${i + 1}] Date: ${e.date} | Title: ${e.title}\nContent: ${e.content}`)
        .join('\n\n');

      const customSection = customPrompt ? `User Persona/Style Override (Enforce this style and behavior): ${customPrompt}\n\n` : '';
      const p = `${customSection}You are "Satori", a warm, highly intuitive, and deeply compassionate Reflection Guide for "Haven Journal". You combine wisdom traditions (Stoicism, Taoism, mindfulness) with clinical empathy (Internal Family Systems, active listening) to act as a loving mirror for the user's memories.

A user is asking a question about their past days or reflections. Using ONLY the provided context entries from their past, answer their query.

Follow these strict psychological guidelines:
1. **Empathic Attunement**: Begin by validating the underlying emotional tone of their question. Make them feel heard and held.
2. **Cozy Narrative Mirroring**: Reconstruct the scenes of the past days. Help them re-experience the feelings (e.g., "On May 24th, you felt a deep sense of relief when you...") to highlight their personal growth, persistence, or capacity for joy.
3. **IFS Parts Awareness**: If they ask about internal conflicts or difficult feelings, frame them gently as temporary parts of them, reminding them of their enduring Core Self.
4. **Gentle Citations**: Naturally weave dates into your guidance (e.g., "On April 12th...") so they can anchor their memories, but keep the prose poetic and flowing.
5. **Epistemic Humility**: If the provided entries do not contain the answer, acknowledge this gently and reflect on related emotional themes from those days to offer warm solace. Do not invent details outside of the provided context.

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
