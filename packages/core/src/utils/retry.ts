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

  /** Injectable sleep, for tests. Receives the signal so waits can be cut short. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;

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

const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETRESET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSPORT_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'ConnectTimeoutError',
  'FetchError',
  'TimeoutError',
]);

/**
 * Retries `429` and `5xx`. For errors with no status, retries only recognized
 * transport faults, by `code`, error name, or a nested `cause` — a `TypeError`
 * from a bug in an adapter would fail identically on every attempt, and retrying
 * it just delays the report. Pass `isRetryable` to widen this.
 *
 * Never retries `AgenticError`, which signals misconfiguration or an exceeded
 * budget rather than a fault, nor an aborted call.
 */
export function isRetryableModelError(err: unknown): boolean {
  if (err instanceof AgenticError) return false;
  if (isAbortError(err)) return false;

  const status = readStatus(err);
  if (status !== undefined) return status === 429 || status >= 500;
  return isTransportError(err);
}

function isTransportError(err: unknown, depth = 0): boolean {
  if (typeof err !== 'object' || err === null || depth > 3) return false;
  const carrier = err as { name?: string; code?: string; cause?: unknown };

  if (carrier.name === 'AbortError') return false;
  if (typeof carrier.code === 'string' && TRANSPORT_CODES.has(carrier.code)) return true;
  if (typeof carrier.name === 'string' && TRANSPORT_NAMES.has(carrier.name)) return true;

  // undici surfaces connection faults as `TypeError: fetch failed` with the real
  // cause nested underneath.
  return isTransportError(carrier.cause, depth + 1);
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
  assertFiniteDelay('initialDelayMs', initialDelayMs);
  assertFiniteDelay('maxDelayMs', maxDelayMs);

  let lastError: unknown = abortError();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.signal?.aborted) throw lastError;

    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }

      const delayMs = computeDelayMs({ attempt, initialDelayMs, maxDelayMs, jitter, err });

      try {
        await options?.onRetry?.({ attempt, maxAttempts, delayMs, error: err });
      } catch {
        // A telemetry hook must not turn a retryable failure into a hard one.
      }

      if (options?.signal?.aborted) throw err;
      await sleep(delayMs, options?.signal);
      if (options?.signal?.aborted) throw err;
    }
  }

  throw lastError;
}

function assertFiniteDelay(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `retryWithBackoff: ${field} must be a finite non-negative number, received ${String(value)}.`,
    );
  }
}

function abortError(): Error {
  return Object.assign(new Error('Retry aborted before any attempt was made.'), {
    name: 'AbortError',
  });
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

/** Resolves early on abort, so cancelling does not wait out the remaining backoff. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', settle);
      resolve();
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener('abort', settle, { once: true });
  });
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
