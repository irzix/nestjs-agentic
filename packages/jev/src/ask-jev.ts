import type { CircuitBreaker } from '@nestjs-agentic/core';
import type {
  JevAnswer,
  JevCallOptions,
  JevClient,
  JevQuestion,
  JevResult,
  JevState,
} from './jev.interface';

const DEFAULT_TIMEOUT_MS = 5000;
/** Largest delay `setTimeout` honors; larger values fire after 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Raised when Jev cannot be reached, times out, or answers in an unexpected shape. */
export class JevCallError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'JevCallError';
  }
}

/** Throws a `RangeError` unless `timeoutMs` is a usable timer delay. */
export function assertTimeout(timeoutMs: number | undefined, owner: string): void {
  if (timeoutMs === undefined) return;
  if (!(typeof timeoutMs === 'number' && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError(
      `${owner}: timeoutMs must be a number above 0 and at most ${MAX_TIMEOUT_MS}, received ${String(timeoutMs)}.`,
    );
  }
}

/**
 * Asks Jev one set of questions about a state, bounded by `timeoutMs` and
 * the caller's `signal`, and checks that every question was answered with the
 * expected type. Throws `JevCallError` otherwise.
 *
 * The bound holds even for a client that ignores `signal`: the call is raced
 * against it.
 */
export async function askJev<Q extends Record<string, JevQuestion>>(
  client: JevClient,
  state: JevState,
  questions: Q,
  options: Omit<JevCallOptions, 'client' | 'circuitBreaker'> & {
    signal?: AbortSignal;
    circuitBreaker?: CircuitBreaker;
  } = {},
): Promise<{ answers: { [K in keyof Q]: JevAnswer & { type: Q[K]['type'] } }; result: JevResult }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertTimeout(timeoutMs, 'askJev');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  // Not unref'd: a pending judgment should keep the process alive until it
  // settles or times out. The timer is always cleared below.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cancelledByCaller = () => options.signal?.aborted === true;

  // Validation is part of the call, so a breaker counts a malformed answer
  // as a failure: a Jev that keeps answering unusably is as down as one
  // that does not answer.
  const call = async (): Promise<JevResult> => {
    const result = await raceAbort(
      () =>
        client.systemOne(
          { state, questions, ...(options.model !== undefined ? { model: options.model } : {}) },
          { signal: controller.signal, timeout: timeoutMs },
        ),
      controller.signal,
    );
    assertAnswered(result, questions);
    return result;
  };

  let result: JevResult;
  try {
    result = options.circuitBreaker
      ? await throughBreaker(options.circuitBreaker, call, cancelledByCaller)
      : await call();
  } catch (err: unknown) {
    if (err instanceof JevCallError) throw err;
    const reason = controller.signal.aborted && !cancelledByCaller()
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new JevCallError(`Jev call failed: ${reason}`, err);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  return { answers: result.answers as { [K in keyof Q]: JevAnswer & { type: Q[K]['type'] } }, result };
}

/** Throws `JevCallError` unless every question got a well-formed answer of its type. */
function assertAnswered(result: JevResult, questions: Record<string, JevQuestion>): void {
  for (const [name, question] of Object.entries(questions)) {
    const answer = result?.answers?.[name];
    if (!answer || answer.type !== question.type || !isWellFormed(answer)) {
      throw new JevCallError(`Jev returned no usable "${question.type}" answer for "${name}".`);
    }
  }
}

/** Settles with the call, or rejects as soon as `signal` aborts, whichever comes first. */
function raceAbort<T>(call: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    // Both outcomes are handled, so a call that settles after the abort is
    // not reported as an unhandled rejection.
    Promise.resolve()
      .then(call)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Runs the call through a circuit breaker. Jev failures, timeouts, and
 * malformed answers count toward tripping it; a call the caller cancelled
 * says nothing about Jev, so it does not, except that a cancelled probe
 * keeps the circuit open.
 */
async function throughBreaker<T>(
  breaker: CircuitBreaker,
  call: () => Promise<T>,
  cancelledByCaller: () => boolean,
): Promise<T> {
  const outcome = await breaker.execute(
    async (): Promise<{ value: T } | { cancelled: unknown }> => {
      try {
        return { value: await call() };
      } catch (err: unknown) {
        if (cancelledByCaller()) return { cancelled: err };
        throw err;
      }
    },
    { deferSuccess: true },
  );
  if ('value' in outcome) {
    breaker.recordSuccess();
    return outcome.value;
  }
  if (breaker.currentState() === 'half_open') breaker.recordFailure('probe cancelled by the caller');
  throw outcome.cancelled;
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isWellFormed(answer: JevAnswer): boolean {
  switch (answer.type) {
    case 'noul':
      return isProbability(answer.noul);
    case 'choice':
      return typeof answer.choice === 'string' && isProbability(answer.confidence);
    case 'score':
      return typeof answer.score === 'number' && Number.isFinite(answer.score);
  }
}

/** Formats a probability for decision reasons, e.g. `0.43`. */
export function formatProbability(p: number): string {
  return p.toFixed(2);
}

/**
 * Formats a configured threshold with at least two decimals and as many more
 * as it needs to be exact, e.g. `0.90` or `0.955`.
 */
export function formatThreshold(t: number): string {
  for (let digits = 2; digits <= 6; digits++) {
    if (Number(t.toFixed(digits)) === t) return t.toFixed(digits);
  }
  return String(t);
}

/**
 * Formats a probability with enough decimals that it compares to every
 * threshold the way the unrounded value does, so a reason never shows
 * `0.90` for a probability that fell just short of `0.90`.
 */
export function formatAgainst(p: number, thresholds: number[]): string {
  for (let digits = 2; digits <= 6; digits++) {
    const shown = Number(p.toFixed(digits));
    if (thresholds.every((t) => (shown >= t) === (p >= t))) return p.toFixed(digits);
  }
  return String(p);
}
