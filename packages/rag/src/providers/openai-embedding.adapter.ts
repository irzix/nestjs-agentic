import type { EmbeddingProvider } from '../interfaces/embedding.interface';

/**
 * Options for configuring OpenAIEmbeddingAdapter.
 */
export interface OpenAIEmbeddingAdapterOptions {
  /** OpenAI API Key. Defaults to `process.env.OPENAI_API_KEY` */
  apiKey?: string;

  /** Embedding model name. Default: `text-embedding-3-small` */
  model?: string;

  /** Optional custom output vector dimensions (supported by `text-embedding-3` models only). */
  dimensions?: number;

  /** Base URL endpoint for OpenAI or OpenAI-compatible servers (e.g. Ollama, LocalAI). Default: `https://api.openai.com/v1` */
  baseUrl?: string;

  /** Custom fetch function implementation (useful for mocking in tests). Default: `globalThis.fetch` */
  fetchFn?: typeof fetch;
}

/**
 * Production OpenAI Embedding Adapter supporting `text-embedding-3-small`, `text-embedding-3-large`,
 * and OpenAI-compatible embedding servers (Ollama, LocalAI, vLLM).
 *
 * @example
 * ```typescript
 * const embedder = new OpenAIEmbeddingAdapter({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small',
 * });
 * ```
 */
export class OpenAIEmbeddingAdapter implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions?: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  /**
   * Creates a new instance of OpenAIEmbeddingAdapter.
   * @param options Configuration for API key, model, dimensions, base URL, and fetch function.
   */
  constructor(options?: OpenAIEmbeddingAdapterOptions) {
    this.apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY || '' : '');
    this.model = options?.model || 'text-embedding-3-small';
    this.dimensions = options?.dimensions;
    this.baseUrl = (options?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  /**
   * Generates a vector embedding for a single text string via the OpenAI Embeddings API.
   *
   * @param text Input text to embed.
   * @returns Promise resolving to a number array representing the embedding vector.
   */
  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] || [];
  }

  /**
   * Generates vector embeddings for a batch of text strings via the OpenAI Embeddings API.
   *
   * @param texts Array of input text strings to embed.
   * @returns Promise resolving to a 2D array of embedding vectors parallel to the input texts.
   * @throws Error if the OpenAI API request fails with a non-200 status.
   */
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
