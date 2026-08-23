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

  /** In-flight embedding requests keyed by cache key, so concurrent misses for the same text coalesce into one provider call. */
  private readonly inFlight = new Map<string, Promise<number[]>>();

  /**
   * Creates a new instance of CachedEmbeddingProvider.
   * @param options Configuration for the wrapped provider, cache backend, size/TTL, and namespace.
   */
  constructor(options: CachedEmbeddingProviderOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.cacheNamespace = options.cacheNamespace ?? 'default';

    if (options.ttlSeconds !== undefined && (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds < 0)) {
      throw new RangeError(`CachedEmbeddingProvider: ttlSeconds must be a finite non-negative number, got ${options.ttlSeconds}`);
    }
    this.ttlSeconds = options.ttlSeconds;

    // maxSize only governs the in-memory LRU; a store-backed cache ignores it,
    // so it's only validated when there's no store to defer to.
    const maxSize = options.maxSize ?? 1000;
    if (!options.store && (!Number.isInteger(maxSize) || maxSize <= 0)) {
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
    const key = this.cacheKey('query', text);
    const cached = await this.getFromCache(key);
    if (cached) return cached.slice();

    const existing = this.inFlight.get(key);
    if (existing) return (await existing).slice();

    const request = this.provider
      .embedQuery(text)
      .then(async (embedding) => {
        await this.putInCache(key, embedding);
        return embedding;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);

    return (await request).slice();
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

    const keys = texts.map((t) => this.cacheKey('document', t));
    const results = new Array<number[] | undefined>(texts.length);

    // Duplicate texts within this call (or already in-flight from a
    // concurrent call) resolve to the same key and must not be re-embedded.
    const keyToPendingIndices = new Map<string, number[]>();

    for (let i = 0; i < texts.length; i++) {
      const key = keys[i];
      const cached = await this.getFromCache(key);
      if (cached) {
        results[i] = cached.slice();
        continue;
      }

      const existing = this.inFlight.get(key);
      if (existing) {
        results[i] = (await existing).slice();
        continue;
      }

      const indices = keyToPendingIndices.get(key);
      if (indices) {
        indices.push(i);
      } else {
        keyToPendingIndices.set(key, [i]);
      }
    }

    const uniqueKeys = Array.from(keyToPendingIndices.keys());
    if (uniqueKeys.length > 0) {
      const uniqueTexts = uniqueKeys.map((key) => texts[keyToPendingIndices.get(key)![0]]);

      const request = this.provider.embedDocuments(uniqueTexts).then((embeddings) => {
        if (embeddings.length !== uniqueTexts.length) {
          throw new Error(
            `CachedEmbeddingProvider: underlying provider returned ${embeddings.length} embedding(s) ` +
              `for ${uniqueTexts.length} uncached text(s).`,
          );
        }
        return embeddings;
      });

      // Register each unique key as in-flight before awaiting, so a
      // concurrent call for the same text joins this request instead of
      // starting a duplicate one. Each derived promise gets its own no-op
      // catch registered immediately so an early throw below doesn't leave
      // the other keys' promises as unhandled rejections.
      const perKeyPromises = new Map<string, Promise<number[]>>();
      for (let u = 0; u < uniqueKeys.length; u++) {
        const key = uniqueKeys[u];
        const perKey = request.then((embeddings) => embeddings[u]).finally(() => this.inFlight.delete(key));
        perKeyPromises.set(key, perKey);
        this.inFlight.set(key, perKey);
        perKey.catch(() => {});
      }

      for (const [key, indices] of keyToPendingIndices) {
        const embedding = await perKeyPromises.get(key)!;
        await this.putInCache(key, embedding);
        for (const i of indices) {
          results[i] = embedding.slice();
        }
      }
    }

    return results.map((embedding, index) => {
      if (embedding === undefined) {
        throw new Error(`CachedEmbeddingProvider: missing embedding at index ${index}`);
      }
      return embedding;
    });
  }

  /**
   * Hashes (namespace, operation, text) into a fixed-length cache key, so
   * arbitrarily long text doesn't bloat keys. The `operation` discriminator
   * keeps `embedQuery` and `embedDocuments` results from colliding for
   * providers that embed queries differently from documents (e.g.
   * instruction-tuned retrieval models with distinct query/document modes).
   */
  private cacheKey(operation: 'query' | 'document', text: string): string {
    return createHash('sha256').update(this.cacheNamespace).update('\0').update(operation).update('\0').update(text).digest('hex');
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
    // Clone before storing: the caller's array must never alias the cached
    // copy, or a later in-place mutation of a returned embedding would
    // silently corrupt the cache.
    const stored = embedding.slice();

    if (this.store) {
      await this.store.set(key, stored, this.ttlSeconds);
      return;
    }

    if (this.memoryCache.size >= this.maxSize && !this.memoryCache.has(key)) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, stored);
  }
}
