import type { EmbeddingProvider } from '../interfaces/embedding.interface';

/**
 * Deterministic Mock Embedding Provider for fast unit testing without requiring external LLM API keys.
 * Generates stable character-frequency-based vectors that are normalized to unit magnitude.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly dimensions: number;

  /**
   * Creates a new instance of MockEmbeddingProvider.
   * @param dimensions Number of dimensions in each generated embedding vector. Default: `8`
   */
  constructor(dimensions = 8) {
    this.dimensions = dimensions;
  }

  /**
   * Generates a deterministic mock embedding vector for a single text string.
   *
   * @param text Input text to embed.
   * @returns Promise resolving to a normalized number array of the configured dimension length.
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  /**
   * Generates deterministic mock embedding vectors for a batch of text strings.
   *
   * @param texts Array of input text strings to embed.
   * @returns Promise resolving to a 2D array of normalized embedding vectors.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateVector(t)));
  }

  /**
   * Internal helper that produces a stable character-frequency vector normalized to unit magnitude.
   *
   * @param text Input text string.
   * @returns Normalized number array of length `this.dimensions`.
   */
  private generateVector(text: string): number[] {
    const vector: number[] = new Array(this.dimensions).fill(0);
    const normalized = text.toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      vector[i % this.dimensions] += charCode / 1000;
    }
    // Normalize vector magnitude
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((val) => val / magnitude);
  }
}
