import { APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';

/**
 * Wraps SDK failures in a single framework-facing error type.
 *
 * Messages carry the provider explanation but never request headers, so
 * credentials are not exposed through logs or error reporting.
 */
export class OpenAiModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OpenAiModelError';
    Object.setPrototypeOf(this, OpenAiModelError.prototype);
  }

  /** Normalizes any thrown value into an OpenAiModelError. */
  static from(error: unknown, model: string): OpenAiModelError {
    if (error instanceof OpenAiModelError) {
      return error;
    }

    // APIUserAbortError extends APIError, so cancellation is classified first.
    if (error instanceof APIUserAbortError || isAbortError(error)) {
      return new OpenAiModelError(
        `OpenAI request for model "${model}" was aborted.`,
        undefined,
        'aborted',
        error,
      );
    }

    if (error instanceof APIConnectionTimeoutError) {
      return new OpenAiModelError(
        `OpenAI request for model "${model}" timed out.`,
        undefined,
        'timeout',
        error,
      );
    }

    if (error instanceof APIError) {
      const status = typeof error.status === 'number' ? error.status : undefined;
      return new OpenAiModelError(
        `OpenAI request for model "${model}" failed${status ? ` with status ${status}` : ''}: ${error.message}`,
        status,
        error.code ?? undefined,
        error,
      );
    }

    return new OpenAiModelError(
      `OpenAI request for model "${model}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      undefined,
      undefined,
      error,
    );
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
