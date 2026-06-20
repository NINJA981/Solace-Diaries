import { getAI } from './ai.service';

/** Shape of a retrieved journal context entry before and after compression. */
export interface ContextEntry {
  title: string;
  date: string;
  content: string;
}

/** Metrics returned alongside the compressed entries for observability. */
export interface CompressionMetrics {
  originalChars: number;
  compressedChars: number;
  compressionRatio: number;
  entryCount: number;
}

/**
 * Compresses retrieved RAG context entries using Gemini to reduce token usage
 * by 60-80% while preserving facts, dates, and emotional nuance.
 *
 * Falls back to the original entries if the compression call fails.
 */
export class ContextCompressionService {
  /**
   * Build the system prompt that instructs Gemini to compress journal entries.
   * The user's question is woven in so the model can bias toward
   * question-relevant facts.
   */
  private buildCompressionPrompt(
    question: string,
    entries: ContextEntry[]
  ): string {
    const entriesBlock = entries
      .map(
        (e, i) =>
          `[Entry #${i + 1}] Date: ${e.date} | Title: ${e.title}\nContent: ${e.content}`
      )
      .join('\n\n');

    return `You are an expert context compressor for a personal journal application called "Solace Diaries".

Your task is to compress the retrieved journal entries below so they use 60-80% fewer tokens while satisfying every constraint listed here:

### Constraints — violating any one of these is a failure
1. **Preserve all important facts**: names, places, numbers, key events, and decisions must survive verbatim.
2. **Preserve every date and time reference**: never drop, approximate, or paraphrase a date.
3. **Preserve the exact emotional tone**: feelings, moods, emotional transitions, metaphors about feelings, and self-reflective insights must be kept. Emotions are the most valuable signal for this journal app.
4. **Question-aware focus**: the user will ask the following question about these entries, so bias your compression toward details that are most relevant to answering it — but still keep all other factual and emotional anchors.
5. **No hallucination**: do not add facts, emotions, or details that are not in the original entry.
6. **Maintain entry boundaries**: return one compressed object per input entry, in the same order.

User's question: "${question}"

### Entries to compress
${entriesBlock}

### Response format
Respond with a JSON array. Each element must match this schema exactly:
{
  "title": "string — the original title, unchanged",
  "date": "string — the original date, unchanged",
  "content": "string — the compressed content"
}

Return ONLY the JSON array. No markdown fences, no commentary.`;
  }

  /**
   * Compress an array of context entries.
   *
   * @returns The compressed entries. On any failure the original entries are
   *          returned unchanged so the downstream pipeline is never blocked.
   */
  public async compress(
    question: string,
    entries: ContextEntry[],
    apiKey?: string
  ): Promise<{ entries: ContextEntry[]; metrics: CompressionMetrics }> {
    // Nothing to compress — short-circuit.
    if (entries.length === 0) {
      return {
        entries,
        metrics: {
          originalChars: 0,
          compressedChars: 0,
          compressionRatio: 0,
          entryCount: 0,
        },
      };
    }

    const originalChars = entries.reduce((sum, e) => sum + e.content.length, 0);

    // Skip the API call for very small contexts (< 500 chars total) — the
    // overhead of a compression call outweighs the savings.
    if (originalChars < 500) {
      return {
        entries,
        metrics: {
          originalChars,
          compressedChars: originalChars,
          compressionRatio: 0,
          entryCount: entries.length,
        },
      };
    }

    try {
      const ai = getAI(apiKey);
      const prompt = this.buildCompressionPrompt(question, entries);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim() || '';
      const parsed: ContextEntry[] = JSON.parse(text);

      // Validate shape — every element must have title, date, content.
      if (
        !Array.isArray(parsed) ||
        parsed.length !== entries.length ||
        parsed.some(
          (e) =>
            typeof e.title !== 'string' ||
            typeof e.date !== 'string' ||
            typeof e.content !== 'string'
        )
      ) {
        console.warn(
          'Compression response failed schema validation, returning originals.'
        );
        return {
          entries,
          metrics: {
            originalChars,
            compressedChars: originalChars,
            compressionRatio: 0,
            entryCount: entries.length,
          },
        };
      }

      const compressedChars = parsed.reduce(
        (sum, e) => sum + e.content.length,
        0
      );
      const compressionRatio =
        originalChars > 0
          ? Math.round(((originalChars - compressedChars) / originalChars) * 100)
          : 0;

      console.log(
        `[Compression] ${entries.length} entries: ${originalChars} → ${compressedChars} chars (${compressionRatio}% reduction)`
      );

      return {
        entries: parsed,
        metrics: {
          originalChars,
          compressedChars,
          compressionRatio,
          entryCount: entries.length,
        },
      };
    } catch (err: any) {
      console.warn(
        'Context compression failed, returning original entries:',
        err.message || err
      );
      return {
        entries,
        metrics: {
          originalChars,
          compressedChars: originalChars,
          compressionRatio: 0,
          entryCount: entries.length,
        },
      };
    }
  }
}
