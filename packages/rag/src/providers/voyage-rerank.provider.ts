import type { RerankFunction } from '../strategies/reranker.strategy';

/** Options for configuring the Voyage AI Rerank provider. */
export interface VoyageRerankProviderOptions {
  /** Voyage AI API Key. Defaults to `process.env.VOYAGE_API_KEY` */
  apiKey?: string;

  /** Rerank model identifier. Default: `rerank-2` */
  model?: string;

  /** Base URL endpoint. Default: `https://api.voyageai.com/v1` */
  baseUrl?: string;

  /** Custom fetch function implementation (useful for mocking in tests). Default: `globalThis.fetch` */
  fetchFn?: typeof fetch;
}

/**
 * Creates a `RerankFunction` backed by the Voyage AI Rerank API
 * (`POST /v1/rerank`), for use as `RerankerStrategyOptions.rerankFn`.
 *
 * @example
 * ```typescript
 * const strategy = new RerankerStrategy({
 *   rerankFn: createVoyageRerankProvider({ apiKey: process.env.VOYAGE_API_KEY }),
 * });
 * ```
 */
export function createVoyageRerankProvider(options?: VoyageRerankProviderOptions): RerankFunction {
  const apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env?.VOYAGE_API_KEY || '' : '');
  const model = options?.model || 'rerank-2';
  const baseUrl = (options?.baseUrl || 'https://api.voyageai.com/v1').replace(/\/+$/, '');
  const fetchFn = options?.fetchFn || globalThis.fetch;

  return async (query, chunks) => {
    if (chunks.length === 0) return [];

    const response = await fetchFn(`${baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents: chunks.map((c) => c.content),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voyage Rerank API failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { data: Array<{ index: number; relevance_score: number }> };
    const scores = new Array<number>(chunks.length).fill(0);
    for (const r of data.data) {
      scores[r.index] = r.relevance_score;
    }
    return scores;
  };
}
