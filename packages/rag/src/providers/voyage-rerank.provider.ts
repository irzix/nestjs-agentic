import type { RerankFunction } from '../strategies/reranker.strategy';
import { mapIndexedRerankScores } from './rerank-response.util';

/** Voyage's documented hard limit on the number of documents per rerank request. */
const VOYAGE_MAX_DOCUMENTS = 1000;

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

  /** Request timeout in milliseconds, after which the request is aborted. Default: `30000` */
  timeoutMs?: number;
}

/**
 * Creates a `RerankFunction` backed by the Voyage AI Rerank API
 * (`POST /v1/rerank`), for use as `RerankerStrategyOptions.rerankFn`.
 *
 * Voyage caps requests at 1000 documents; calling this with more chunks
 * throws before making a request, rather than sending a request the API
 * will reject.
 *
 * @param options API key, model, base URL, fetch override, and timeout configuration.
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
  const timeoutMs = options?.timeoutMs ?? 30000;

  return async (query, chunks) => {
    if (chunks.length === 0) return [];
    if (chunks.length > VOYAGE_MAX_DOCUMENTS) {
      throw new Error(
        `Voyage Rerank API: received ${chunks.length} documents, exceeding the API's limit of ${VOYAGE_MAX_DOCUMENTS} per request`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Voyage Rerank API request timed out after ${timeoutMs}ms`)), timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/rerank`, {
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
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voyage Rerank API failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as unknown;
    return mapIndexedRerankScores(data, 'data', chunks.length, 'Voyage Rerank API');
  };
}
