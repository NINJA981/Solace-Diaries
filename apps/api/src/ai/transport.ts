/**
 * The seam between our gateway and a concrete model provider. Production uses the Google
 * transport; tests inject a deterministic fake so no test ever touches the network.
 * Transports do one attempt each — retries, timeouts and validation live in the gateway.
 * HTTP failures must be thrown as errors carrying a numeric `status`.
 */
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
export type Turn = { role: 'user' | 'model'; parts: Part[] };

export type GenerateRequest = {
  model: string;
  system?: string;
  contents: Turn[];
  /** JSON mode: provider-ready JSON schema the output must follow. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
};

export type GenerateResult = { text: string; tokens: number };
export type StreamChunk = { text: string; tokens?: number };

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

export type EmbedRequest = {
  model: string;
  texts: string[];
  taskType: EmbedTaskType;
  dimensions: number;
  signal: AbortSignal;
};

export interface AiTransport {
  generate(req: GenerateRequest): Promise<GenerateResult>;
  stream(req: GenerateRequest): AsyncIterable<StreamChunk>;
  /** One vector per input text, same order. */
  embed(req: EmbedRequest): Promise<number[][]>;
}

export type TransportFactory = (apiKey: string) => AiTransport;
