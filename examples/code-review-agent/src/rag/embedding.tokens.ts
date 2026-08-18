/**
 * DI injection token for the active EmbeddingProvider.
 *
 * Resolves to `OpenAIEmbeddingAdapter` (Perplexity via OpenRouter) when
 * `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is present in the environment.
 * Falls back to `MockEmbeddingProvider` for local / CI environments.
 */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';
