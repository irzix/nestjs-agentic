import { AgenticError } from '../errors';

export interface RetryOptions {
  /** Total attempts, including the first. `1` disables retrying. Default: `3` */
  maxAttempts?: number;

  /** Delay before the first retry. Doubles each attempt. Default: `250` */
  initialDelayMs?: number;

  /** Ceiling for a single backoff delay. Default: `10_000` */
  maxDelayMs?: number;

  /**
   * Fraction of each delay randomized, 0 to 1. Default: `0.5`
   *
   * Without jitter, callers that failed together retry together and re-create
   * the spike that caused the failure.
   */
  jitter?: number;

  /** Defaults to `isRetryableModelError`. */
  isRetryable?: (err: unknown) => boolean;

  onRetry?: (event: RetryAttemptEvent) => void | Promise<void>;

  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;

  signal?: AbortSignal;
}

export interface RetryAttemptEvent {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  maxAttempts: number;
  /** Delay applied before the next attempt, after jitter. */
  delayMs: number;
  error: unknown;
}

/** Error shapes carrying a provider back-off hint, as `Retry-After` would. */
export interface RetryAfterCarrier {
  retryAfterMs?: number;
  retryAfterSeconds?: number;
  /** Seconds, matching the HTTP header. */
  retryAfter?: number | string;
  status?: number;
  statusCode?: number;
}

/**
 * Retries `429`, `5xx`, and status-less errors (network/timeout). Refuses other
 * `4xx`, which fail identically on every attempt, and refuses `AgenticError`,
 * which signals misconfiguration or an exceeded budget rather than a fault.
 */
export function isRetryableModelError(err: unknown): boolean {
  if (err instanceof AgenticError) return false;
  if (isAbortError(err)) return false;

  const status = readStatus(err);
  if (status === undefined) return true;
  if (status === 429) return true;
  return status >= 500;
}

export function readRetryAfterMs(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const carrier = err as RetryAfterCarrier;

  if (typeof carrier.retryAfterMs === 'number' && Number.isFinite(carrier.retryAfterMs)) {
    return Math.max(0, carrier.retryAfterMs);
  }
  if (typeof carrier.retryAfterSeconds === 'number' && Number.isFinite(carrier.retryAfterSeconds)) {
    return Math.max(0, carrier.retryAfterSeconds * 1000);
  }

  const seconds =
    typeof carrier.retryAfter === 'string' ? Number(carrier.retryAfter) : carrier.retryAfter;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  return undefined;
}

/**
 * Runs `operation`, retrying transient failures with exponential backoff and
 * jitter. A provider's own `Retry-After` hint wins over the computed delay.
 * Rethrows the last error once attempts are exhausted.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 250;
  const maxDelayMs = options?.maxDelayMs ?? 10_000;
  const jitter = options?.jitter ?? 0.5;
  const isRetryable = options?.isRetryable ?? isRetryableModelError;
  const sleep = options?.sleep ?? defaultSleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(
      `retryWithBackoff: maxAttempts must be a positive integer, received ${String(maxAttempts)}.`,
    );
  }
  if (!(jitter >= 0 && jitter <= 1)) {
    throw new TypeError(
      `retryWithBackoff: jitter must be between 0 and 1, received ${String(jitter)}.`,
    );
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }

      const delayMs = computeDelayMs({ attempt, initialDelayMs, maxDelayMs, jitter, err });

      await options?.onRetry?.({ attempt, maxAttempts, delayMs, error: err });

      if (options?.signal?.aborted) throw err;
      await sleep(delayMs);
      if (options?.signal?.aborted) throw err;
    }
  }

  throw lastError;
}

function computeDelayMs(input: {
  attempt: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  err: unknown;
}): number {
  const hinted = readRetryAfterMs(input.err);
  if (hinted !== undefined) {
    return Math.min(hinted, input.maxDelayMs);
  }

  const exponential = Math.min(input.initialDelayMs * 2 ** (input.attempt - 1), input.maxDelayMs);

  // Randomize downward only, so a delay never exceeds maxDelayMs.
  return Math.max(0, Math.round(exponential * (1 - input.jitter * Math.random())));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

function readStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const carrier = err as RetryAfterCarrier;
  const status = carrier.status ?? carrier.statusCode;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}
