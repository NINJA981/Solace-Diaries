import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';
import type { AiTransport, GenerateRequest, TransportFactory } from './transport';

/**
 * @google/genai transport. The SDK's own retries stay off (no `retryOptions`) and the
 * timeout is enforced through the abort signal, so the gateway is the single policy point.
 */
export const googleTransport: TransportFactory = (apiKey) => {
  const client = new GoogleGenAI({ apiKey });

  const configOf = (req: GenerateRequest): GenerateContentConfig => ({
    abortSignal: req.signal,
    ...(req.system ? { systemInstruction: req.system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
    ...(req.jsonSchema
      ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema }
      : {}),
  });

  const transport: AiTransport = {
    async generate(req) {
      const res = await client.models.generateContent({
        model: req.model,
        contents: req.contents,
        config: configOf(req),
      });
      return { text: res.text ?? '', tokens: res.usageMetadata?.totalTokenCount ?? 0 };
    },

    async *stream(req) {
      const iter = await client.models.generateContentStream({
        model: req.model,
        contents: req.contents,
        config: configOf(req),
      });
      for await (const chunk of iter) {
        yield { text: chunk.text ?? '', tokens: chunk.usageMetadata?.totalTokenCount };
      }
    },

    async embed(req) {
      // Content objects (not bare strings) so every model treats each text as its own request.
      const res = await client.models.embedContent({
        model: req.model,
        contents: req.texts.map((text) => ({ role: 'user', parts: [{ text }] })),
        config: {
          abortSignal: req.signal,
          taskType: req.taskType,
          outputDimensionality: req.dimensions,
        },
      });
      return (res.embeddings ?? []).map((e) => e.values ?? []);
    },
  };
  return transport;
};
