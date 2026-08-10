/**
 * Provider interface for generating text vector embeddings.
 */
export interface EmbeddingProvider {
  /**
   * Generates a vector embedding for a single search query text string.
   *
   * @param text The input query text.
   * @returns A promise resolving to an array of floating-point numbers representing the embedding vector.
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * Generates vector embeddings for a batch of document texts.
   *
   * @param texts Array of document text strings.
   * @returns A promise resolving to a 2D array of floating-point embedding vectors.
   */
  embedDocuments(texts: string[]): Promise<number[][]>;
}
