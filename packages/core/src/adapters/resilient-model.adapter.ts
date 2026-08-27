import type {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
} from '../interfaces/model.interface';
import { CircuitBreaker } from '../utils/circuit-breaker';
import type {
  CircuitBreakerOptions,
  CircuitState,
  CircuitStateChangeEvent,
} from '../utils/circuit-breaker';
import { retryWithBackoff } from '../utils/retry';
import type { RetryAttemptEvent, RetryOptions } from '../utils/retry';

export interface ModelResilienceOptions {
  /** Omit to disable retrying. */
  retry?: Omit<RetryOptions, 'onRetry' | 'signal'>;

  /** Omit to disable the breaker. */
  circuitBreaker?: Omit<CircuitBreakerOptions, 'onStateChange'>;
}

export interface ModelResilienceHooks {
  onRetry?: (event: RetryAttemptEvent) => void | Promise<void>;
  onCircuitStateChange?: (event: CircuitStateChangeEvent) => void | Promise<void>;
}

/**
 * Wraps a `ModelAdapter` with retry-with-backoff and a circuit breaker.
 *
 * The breaker sits outside the retry, so exhausting retries counts as one
 * failure against the threshold: "5 consecutive failures" means five failed
 * calls, not five attempts within one call.
 *
 * @example
 * ```typescript
 * const resilient = new ResilientModelAdapter(openAiAdapter, {
 *   retry: { maxAttempts: 3 },
 *   circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
 * });
 * ```
 */
export class ResilientModelAdapter implements ModelAdapter {
  private readonly breaker?: CircuitBreaker;
  private readonly retryOptions?: ModelResilienceOptions['retry'];

  constructor(
    private readonly inner: ModelAdapter,
    options: ModelResilienceOptions,
    private readonly hooks?: ModelResilienceHooks,
    breakerName = inner.constructor?.name ?? 'model',
  ) {
    this.retryOptions = options.retry;

    if (options.circuitBreaker) {
      this.breaker = new CircuitBreaker(breakerName, {
        ...options.circuitBreaker,
        onStateChange: (event) => {
          void this.hooks?.onCircuitStateChange?.(event);
        },
      });
    }

    // Only expose `stream` when the wrapped adapter supports it, so callers keep
    // using their existing `adapter.stream ? ... : ...` branch unchanged.
    if (!inner.stream) {
      this.stream = undefined;
    }
  }

  /** `undefined` when no breaker is configured. */
  circuitState(): CircuitState | undefined {
    return this.breaker?.currentState();
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    return this.guard(() => this.withRetry(() => this.inner.generate(request), request.signal));
  }

  stream?(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const inner = this.inner;
    const guard = <T>(operation: () => Promise<T>) => this.guard(operation);
    const withRetry = <T>(operation: () => Promise<T>) => this.withRetry(operation, request.signal);

    return {
      async *[Symbol.asyncIterator]() {
        // Retrying is only safe until the first chunk escapes, so an attempt
        // covers opening the stream and pulling its first chunk. Past that a
        // retry would duplicate emitted output, so failures propagate.
        const opened = await guard(() =>
          withRetry(async () => {
            const iterator = inner.stream!(request)[Symbol.asyncIterator]();
            const first = await iterator.next();
            return { iterator, first };
          }),
        );

        if (opened.first.done) return;
        yield opened.first.value;

        for (let next = await opened.iterator.next(); !next.done; next = await opened.iterator.next()) {
          yield next.value;
        }
      },
    };
  }

  private guard<T>(operation: () => Promise<T>): Promise<T> {
    return this.breaker ? this.breaker.execute(operation) : operation();
  }

  private withRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.retryOptions) return operation();

    return retryWithBackoff(operation, {
      ...this.retryOptions,
      signal,
      onRetry: (event) => this.hooks?.onRetry?.(event),
    });
  }
}
