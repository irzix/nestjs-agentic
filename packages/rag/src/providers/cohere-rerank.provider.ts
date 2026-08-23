import type { RerankFunction } from '../strategies/reranker.strategy';

/** Options for configuring the Cohere Rerank provider. */
export interface CohereRerankProviderOptions {
  /** Cohere API Key. Defaults to `process.env.COHERE_API_KEY` */
  apiKey?: string;

  /** Rerank model identifier. Default: `rerank-v3.5` */
  model?: string;

  /** Base URL endpoint. Default: `https://api.cohere.com/v2` */
  baseUrl?: string;

  /** Custom fetch function implementation (useful for mocking in tests). Default: `globalThis.fetch` */
  fetchFn?: typeof fetch;
}

/**
 * Creates a `RerankFunction` backed by the Cohere Rerank v2 API
 * (`POST /v2/rerank`), for use as `RerankerStrategyOptions.rerankFn`.
 *
 * @example
 * ```typescript
 * const strategy = new RerankerStrategy({
 *   rerankFn: createCohereRerankProvider({ apiKey: process.env.COHERE_API_KEY }),
 * });
 * ```
 */
export function createCohereRerankProvider(options?: CohereRerankProviderOptions): RerankFunction {
  const apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env?.COHERE_API_KEY || '' : '');
  const model = options?.model || 'rerank-v3.5';
  const baseUrl = (options?.baseUrl || 'https://api.cohere.com/v2').replace(/\/+$/, '');
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
      throw new Error(`Cohere Rerank API failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { results: Array<{ index: number; relevance_score: number }> };
    const scores = new Array<number>(chunks.length).fill(0);
    for (const r of data.results) {
      scores[r.index] = r.relevance_score;
    }
    return scores;
  };
}
