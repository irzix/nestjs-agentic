import type { RerankFunction } from '../strategies/reranker.strategy';
import { mapIndexedRerankScores } from './rerank-response.util';

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

  /** Request timeout in milliseconds, after which the request is aborted. Default: `30000` */
  timeoutMs?: number;
}

/**
 * Creates a `RerankFunction` backed by the Cohere Rerank v2 API
 * (`POST /v2/rerank`), for use as `RerankerStrategyOptions.rerankFn`.
 *
 * @param options API key, model, base URL, fetch override, and timeout configuration.
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
  const timeoutMs = options?.timeoutMs ?? 30000;

  return async (query, chunks) => {
    if (chunks.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Cohere Rerank API request timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cohere Rerank API failed (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as unknown;
      return mapIndexedRerankScores(data, 'results', chunks.length, 'Cohere Rerank API');
    } finally {
      // Body reads (response.text()/json()) can stall independently of the
      // headers response, so the timer must stay armed until they finish too.
      clearTimeout(timer);
    }
  };
}
