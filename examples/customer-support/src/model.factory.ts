import { OpenAiModelAdapter } from '@nestjs-agentic/openai';
import type { OpenAiModelAdapterOptions } from '@nestjs-agentic/openai';

/**
 * Builds the model adapter for the built-in agent runtime.
 *
 * `OPENAI_BASE_URL` lets the same example run against any Chat Completions
 * compatible server, for example `http://localhost:11434/v1` for Ollama.
 */
export function createModelAdapter(
  overrides: OpenAiModelAdapterOptions = {},
): OpenAiModelAdapter {
  return new OpenAiModelAdapter({
    // Local servers ignore the key, but the SDK requires a non-empty value.
    apiKey: process.env.OPENAI_API_KEY ?? 'not-needed',
    ...(process.env.OPENAI_BASE_URL ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
    ...overrides,
  });
}

/** Model used when an agent does not override it. */
export const defaultModel = {
  provider: 'openai' as const,
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};
