import { createHash } from 'crypto';
import type { StateStore } from '@nestjs-agentic/core';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';

/** Options for configuring CachedEmbeddingProvider. */
export interface CachedEmbeddingProviderOptions {
  /** The underlying provider whose results are cached. */
  provider: EmbeddingProvider;

  /**
   * Optional pluggable cache backend (e.g. Redis-backed `StateStore`). When
   * omitted, an in-memory LRU cache is used instead.
   */
  store?: StateStore;

  /** Maximum number of entries kept by the in-memory LRU cache. Ignored when `store` is provided. Default: `1000` */
  maxSize?: number;

  /** Cache entry TTL in seconds, used only when `store` is provided (Redis etc. handle their own expiry). Default: `undefined` (no expiry) */
  ttlSeconds?: number;

  /** Identifier distinguishing this provider's cache entries from another provider/model using the same store. Default: `'default'` */
  cacheNamespace?: string;
}

/**
 * `EmbeddingProvider` decorator that caches embeddings by a hash of
 * (namespace, text), so re-embedding identical content — a re-indexed
 * unchanged file, or a repeated query string — skips the underlying
 * provider call entirely.
 *
 * Uses an in-memory LRU cache by default, or a pluggable `StateStore` (e.g.
 * Redis) when one is supplied, so the cache can be shared across processes.
 *
 * The cache key includes `cacheNamespace`, so two providers with different
 * models/dimensions sharing one cache backend never collide.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  private readonly provider: EmbeddingProvider;
  private readonly store?: StateStore;
  private readonly maxSize: number;
  private readonly ttlSeconds?: number;
  private readonly cacheNamespace: string;

  /** In-memory LRU cache, used when no `store` is configured. Insertion order doubles as recency order. */
  private readonly memoryCache = new Map<string, number[]>();

  /**
   * Creates a new instance of CachedEmbeddingProvider.
   * @param options Configuration for the wrapped provider, cache backend, size/TTL, and namespace.
   */
  constructor(options: CachedEmbeddingProviderOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.cacheNamespace = options.cacheNamespace ?? 'default';
    this.ttlSeconds = options.ttlSeconds;

    const maxSize = options.maxSize ?? 1000;
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new RangeError(`CachedEmbeddingProvider: maxSize must be a positive integer, got ${maxSize}`);
    }
    this.maxSize = maxSize;
  }

  /**
   * Returns a cached embedding for `text`, or generates and caches one via
   * the underlying provider's `embedQuery`.
   *
   * @param text Input text to embed.
   * @returns Promise resolving to the embedding vector.
   */
  async embedQuery(text: string): Promise<number[]> {
    const key = this.cacheKey(text);
    const cached = await this.getFromCache(key);
    if (cached) return cached;

    const embedding = await this.provider.embedQuery(text);
    await this.putInCache(key, embedding);
    return embedding;
  }

  /**
   * Returns cached embeddings where available, batching only the uncached
   * texts into a single `embedDocuments` call to the underlying provider.
   *
   * @param texts Array of input text strings to embed.
   * @returns Promise resolving to a 2D array of embedding vectors, parallel to `texts`.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const keys = texts.map((t) => this.cacheKey(t));
    const results = new Array<number[] | undefined>(texts.length);
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = await this.getFromCache(keys[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
      }
    }

    if (uncachedIndices.length > 0) {
      const uncachedTexts = uncachedIndices.map((i) => texts[i]);
      const embeddings = await this.provider.embedDocuments(uncachedTexts);

      if (embeddings.length !== uncachedTexts.length) {
        throw new Error(
          `CachedEmbeddingProvider: underlying provider returned ${embeddings.length} embedding(s) ` +
            `for ${uncachedTexts.length} uncached text(s).`,
        );
      }

      for (let j = 0; j < uncachedIndices.length; j++) {
        const i = uncachedIndices[j];
        results[i] = embeddings[j];
        await this.putInCache(keys[i], embeddings[j]);
      }
    }

    return results as number[][];
  }

  /** Hashes (namespace, text) into a fixed-length cache key, so arbitrarily long text doesn't bloat keys. */
  private cacheKey(text: string): string {
    return createHash('sha256').update(this.cacheNamespace).update('\0').update(text).digest('hex');
  }

  private async getFromCache(key: string): Promise<number[] | undefined> {
    if (this.store) {
      const value = await this.store.get<number[]>(key);
      return value ?? undefined;
    }

    const value = this.memoryCache.get(key);
    if (value) {
      // Refresh recency: delete + re-insert moves this entry to the end (most-recently-used).
      this.memoryCache.delete(key);
      this.memoryCache.set(key, value);
    }
    return value;
  }

  private async putInCache(key: string, embedding: number[]): Promise<void> {
    if (this.store) {
      await this.store.set(key, embedding, this.ttlSeconds);
      return;
    }

    if (this.memoryCache.size >= this.maxSize && !this.memoryCache.has(key)) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, embedding);
  }
}
