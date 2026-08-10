import type { EmbeddingProvider } from '../interfaces/embedding.interface';

/**
 * Deterministic Mock Embedding Provider for fast unit testing without requiring external LLM API keys.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly dimensions: number;

  constructor(dimensions = 8) {
    this.dimensions = dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateVector(t)));
  }

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
