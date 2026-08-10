import type { EmbeddingProvider } from '../interfaces/embedding.interface';

/** Type alias for a custom batch embedding function. */
export type EmbedFunction = (texts: string[]) => Promise<number[][]> | number[][];

/**
 * Generic Custom Embedding Adapter wrapping any custom embedding service, HuggingFace model,
 * FastEmbed runner, or local LLM inference endpoint via a single closure function.
 *
 * @example
 * ```typescript
 * const adapter = new CustomEmbeddingAdapter(
 *   async (texts) => embeddingService.embed(texts)
 * );
 * ```
 */
export class CustomEmbeddingAdapter implements EmbeddingProvider {
  private readonly embedFn: EmbedFunction;

  /**
   * Creates a new instance of CustomEmbeddingAdapter.
   * @param embedFn A batch embedding function accepting an array of text strings and returning a 2D vector array.
   */
  constructor(embedFn: EmbedFunction) {
    this.embedFn = embedFn;
  }

  /**
   * Generates a vector embedding for a single text string.
   *
   * @param text Input text to embed.
   * @returns Promise resolving to a number array representing the embedding vector.
   */
  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] || [];
  }

  /**
   * Generates vector embeddings for a batch of text strings.
   *
   * @param texts Array of input text strings to embed.
   * @returns Promise resolving to a 2D array of embedding vectors parallel to the input texts.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    return this.embedFn(texts);
  }
}
