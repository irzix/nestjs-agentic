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

  /**
   * Omit to disable the breaker. Pass an existing `CircuitBreaker` to share one
   * across adapter instances, which is how long-lived state survives per-request
   * wrappers.
   */
  circuitBreaker?: Omit<CircuitBreakerOptions, 'onStateChange'> | CircuitBreaker;
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

    if (options.circuitBreaker instanceof CircuitBreaker) {
      this.breaker = options.circuitBreaker;
    } else if (options.circuitBreaker) {
      this.breaker = new CircuitBreaker(breakerName, {
        ...options.circuitBreaker,
        onStateChange: (event) => {
          void Promise.resolve(this.hooks?.onCircuitStateChange?.(event)).catch(() => undefined);
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
    const breaker = this.breaker;
    const guard = <T>(operation: () => Promise<T>, options?: { deferSuccess?: boolean }) =>
      this.guard(operation, options);
    const withRetry = <T>(operation: () => Promise<T>) => this.withRetry(operation, request.signal);

    return {
      async *[Symbol.asyncIterator]() {
        // Retrying is only safe until the first chunk escapes, so an attempt
        // covers opening the stream and pulling its first chunk. Past that a
        // retry would duplicate emitted output, so failures propagate.
        // Success is deferred to a full drain. Scoring the open as a success
        // would reset the failure count, so a provider that always dies
        // mid-stream could never trip the circuit.
        const opened = await guard(
          () =>
            withRetry(async () => {
              const iterator = inner.stream!(request)[Symbol.asyncIterator]();
              const first = await iterator.next();
              return { iterator, first };
            }),
          { deferSuccess: true },
        );

        if (opened.first.done) {
          breaker?.recordSuccess();
          return;
        }

        let settled = false;
        try {
          yield opened.first.value;

          for (
            let next = await opened.iterator.next();
            !next.done;
            next = await opened.iterator.next()
          ) {
            yield next.value;
          }
          settled = true;
          breaker?.recordSuccess();
        } catch (err) {
          settled = true;
          breaker?.recordFailure(err instanceof Error ? err.message : String(err));
          throw err;
        } finally {
          if (!settled) {
            // The caller abandoned the loop. Chunks did arrive, so the provider
            // is healthy, but its stream still has to be closed.
            breaker?.recordSuccess();
            await opened.iterator.return?.();
          }
        }
      },
    };
  }

  private guard<T>(
    operation: () => Promise<T>,
    options?: { deferSuccess?: boolean },
  ): Promise<T> {
    return this.breaker ? this.breaker.execute(operation, options) : operation();
  }

  private withRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.retryOptions) return operation();

    return retryWithBackoff(operation, {
      ...this.retryOptions,
      signal,
      onRetry: async (event) => {
        try {
          await this.hooks?.onRetry?.(event);
        } catch {
          // Telemetry must not decide whether a retry proceeds.
        }
      },
    });
  }
}
