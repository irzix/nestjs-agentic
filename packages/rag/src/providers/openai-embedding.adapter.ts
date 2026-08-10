import type { EmbeddingProvider } from '../interfaces/embedding.interface';

export interface OpenAIEmbeddingAdapterOptions {
  /** OpenAI API Key. Defaults to process.env.OPENAI_API_KEY */
  apiKey?: string;
  /** Embedding model name. Default: text-embedding-3-small */
  model?: string;
  /** Optional custom output vector dimensions (supported by text-embedding-3 models). */
  dimensions?: number;
  /** Base URL endpoint for OpenAI or OpenAI-compatible servers (e.g. Ollama, LocalAI). Default: https://api.openai.com/v1 */
  baseUrl?: string;
  /** Custom fetch function implementation. Default: globalThis.fetch */
  fetchFn?: typeof fetch;
}

/**
 * Production OpenAI Embedding Adapter supporting text-embedding-3-small, text-embedding-3-large,
 * and OpenAI-compatible embedding servers (Ollama, LocalAI, vLLM).
 */
export class OpenAIEmbeddingAdapter implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions?: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: OpenAIEmbeddingAdapterOptions) {
    this.apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY || '' : '');
    this.model = options?.model || 'text-embedding-3-small';
    this.dimensions = options?.dimensions;
    this.baseUrl = (options?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] || [];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.dimensions) {
      body.dimensions = this.dimensions;
    }

    const response = await this.fetchFn(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Embedding API failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
    data.data.sort((a, b) => a.index - b.index);
    return data.data.map((item) => item.embedding);
  }
}
