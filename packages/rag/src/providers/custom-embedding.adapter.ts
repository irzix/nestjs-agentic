import type { EmbeddingProvider } from '../interfaces/embedding.interface';

export type EmbedFunction = (texts: string[]) => Promise<number[][]> | number[][];

/**
 * Generic Custom Embedding Adapter wrapping any custom embedding service, HuggingFace model, FastEmbed, or Local LLM.
 */
export class CustomEmbeddingAdapter implements EmbeddingProvider {
  private readonly embedFn: EmbedFunction;

  constructor(embedFn: EmbedFunction) {
    this.embedFn = embedFn;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] || [];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    return this.embedFn(texts);
  }
}
