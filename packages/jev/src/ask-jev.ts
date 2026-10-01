import type {
  JevAnswer,
  JevCallOptions,
  JevClient,
  JevQuestion,
  JevResult,
  JevState,
} from './jev.interface';

const DEFAULT_TIMEOUT_MS = 5000;

/** Raised when Jev cannot be reached, times out, or answers in an unexpected shape. */
export class JevCallError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'JevCallError';
  }
}

/**
 * Asks Jev one set of questions about a state, bounded by `timeoutMs` and
 * the caller's `signal`, and checks that every question was answered with the
 * expected type. Throws `JevCallError` otherwise.
 */
export async function askJev<Q extends Record<string, JevQuestion>>(
  client: JevClient,
  state: JevState,
  questions: Q,
  options: Omit<JevCallOptions, 'client'> & { signal?: AbortSignal } = {},
): Promise<{ answers: { [K in keyof Q]: JevAnswer & { type: Q[K]['type'] } }; result: JevResult }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  // Not unref'd: a pending judgment should keep the process alive until it
  // settles or times out. The timer is always cleared below.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result: JevResult;
  try {
    result = await client.systemOne(
      { state, questions, ...(options.model !== undefined ? { model: options.model } : {}) },
      { signal: controller.signal, timeout: timeoutMs },
    );
  } catch (err: unknown) {
    const reason = controller.signal.aborted && !options.signal?.aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new JevCallError(`Jev call failed: ${reason}`, err);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  for (const [name, question] of Object.entries(questions)) {
    const answer = result?.answers?.[name];
    if (!answer || answer.type !== question.type || !isWellFormed(answer)) {
      throw new JevCallError(`Jev returned no usable "${question.type}" answer for "${name}".`);
    }
  }
  return { answers: result.answers as { [K in keyof Q]: JevAnswer & { type: Q[K]['type'] } }, result };
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
