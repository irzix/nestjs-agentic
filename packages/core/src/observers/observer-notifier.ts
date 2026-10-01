import type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentObserver,
  AgentStartEvent,
  CircuitBreakerEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  ModelRetryEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../interfaces/observer.interface';
import { defaultErrorRedactor, RedactedError, type ErrorRedactor } from './error-redaction';

const REDACTION_FAILED = '[error redaction failed]';

type ObserverMethod<K extends keyof AgentObserver> = NonNullable<AgentObserver[K]>;

/**
 * Options configuring observer event dispatching.
 */
export interface ObserverNotifierOptions {
  /**
   * Sampling rate between 0.0 (0%) and 1.0 (100%).
   * Controls what fraction of execution turns emit telemetry events.
   * Defaults to 1.0 (all turns are observed).
   */
  samplingRate?: number;
  /**
   * Upper bound, in milliseconds, on how long a lifecycle hook waits for its
   * observers. Observers that are still running keep going in the background;
   * the caller simply stops waiting for them. `0` never waits. Unset waits
   * for every observer, which is the original behavior.
   */
  timeoutMs?: number;
  /**
   * How errors are scrubbed before observers see them. Defaults to
   * `defaultErrorRedactor`; `'none'` dispatches the original error unchanged.
   * See `ObservabilityOptions.errorRedaction`.
   */
  errorRedaction?: ErrorRedactor | 'none';
}

/**
 * Dispatches runtime observer lifecycle hooks with complete error isolation.
 * Observers are executed concurrently using Promise.allSettled so that a slow or
 * failing observer never throws or disrupts the primary agent execution. Set
 * `timeoutMs` so a slow observer cannot delay it either.
 *
 * Errors are redacted here, once, for every error-carrying event, so no call
 * site can forget to: `AgentErrorEvent.error`, `ModelRetryEvent.error`, and
 * `CircuitBreakerEvent.reason`.
 */
export class ObserverNotifier {
  private readonly observers: AgentObserver[];
  private readonly samplingRate: number;
  private readonly isSampled: boolean;
  private readonly timeoutMs?: number;
  private readonly redactError?: ErrorRedactor;

  constructor(
    observers: AgentObserver[] = [],
    options: ObserverNotifierOptions = {},
  ) {
    this.observers = observers.filter(Boolean);
    const rate = options.samplingRate ?? 1.0;
    this.samplingRate = Math.max(0, Math.min(1, rate));
    this.isSampled = this.samplingRate >= 1.0 || Math.random() < this.samplingRate;
    if (options.timeoutMs !== undefined && !(options.timeoutMs >= 0 && Number.isFinite(options.timeoutMs))) {
      throw new Error(`Observer timeoutMs must be a non-negative finite number, received ${options.timeoutMs}.`);
    }
    this.timeoutMs = options.timeoutMs;
    // Validated rather than coerced: a stray `false` from untyped config must
    // not quietly turn redaction off.
    const redaction = options.errorRedaction ?? defaultErrorRedactor;
    if (redaction !== 'none' && typeof redaction !== 'function') {
      throw new Error(
        `Observer errorRedaction must be an ErrorRedactor function or 'none', received ${String(redaction)}.`,
      );
    }
    this.redactError = redaction === 'none' ? undefined : redaction;
  }

  get length(): number {
    return this.observers.length;
  }

  get isEnabled(): boolean {
    return this.observers.length > 0 && this.isSampled;
  }

  async notifyAgentStart(event: AgentStartEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onAgentStart', event);
  }

  async notifyAgentEnd(event: AgentEndEvent): Promise<void> {
    if (!this.isEnabled || !this.hasHook('onAgentEnd')) return;
    const toolCalls = event.result.toolCalls?.map((call) => ({ ...call, result: this.redactToolFailure(call.result) }));
    await this.dispatch('onAgentEnd', toolCalls ? { ...event, result: { ...event.result, toolCalls } } : event);
  }

  async notifyModelRequest(event: ModelRequestEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onModelRequest', event);
  }

  async notifyModelResponse(event: ModelResponseEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onModelResponse', event);
  }

  async notifyModelRetry(event: ModelRetryEvent): Promise<void> {
    if (!this.isEnabled || !this.hasHook('onModelRetry')) return;
    await this.dispatch('onModelRetry', { ...event, error: this.redact(event.error) });
  }

  async notifyCircuitStateChange(event: CircuitBreakerEvent): Promise<void> {
    if (!this.isEnabled || !this.hasHook('onCircuitStateChange')) return;
    // The reason embeds the failing call's error message.
    await this.dispatch('onCircuitStateChange', { ...event, reason: this.redactText(event.reason) });
  }

  async notifyToolCall(event: ToolCallEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onToolCall', event);
  }

  async notifyToolResult(event: ToolResultEvent): Promise<void> {
    if (!this.isEnabled || !this.hasHook('onToolResult')) return;
    await this.dispatch('onToolResult', { ...event, result: this.redactToolFailure(event.result) });
  }

  async notifyError(event: AgentErrorEvent): Promise<void> {
    if (!this.isEnabled || !this.hasHook('onError')) return;
    await this.dispatch('onError', { ...event, error: this.redact(event.error) });
  }

  /** Whether any observer implements `hook`, so nothing is redacted for no one. */
  private hasHook(hook: keyof AgentObserver): boolean {
    return this.observers.some((observer) => typeof observer[hook] === 'function');
  }

  /**
   * Applies the configured redactor. A redactor that throws, or returns
   * something that is not an object, yields a placeholder: falling back to the
   * raw error would defeat the point.
   */
  private redact<T>(error: T): T | Error {
    if (!this.redactError) return error;
    try {
      const redacted: unknown = this.redactError(error);
      return typeof redacted === 'object' && redacted !== null
        ? (redacted as Error)
        : new RedactedError('Error', REDACTION_FAILED);
    } catch {
      return new RedactedError('Error', REDACTION_FAILED);
    }
  }

  /**
   * Redacts free text that embeds an error message, with the redactor's
   * `redactText` when it has one. Never throws.
   */
  private redactText(text: string): string {
    if (!this.redactError) return text;
    try {
      if (this.redactError.redactText) return this.redactError.redactText(text);
      const message = (this.redactError(new Error(text)) as { message?: unknown } | null | undefined)?.message;
      return typeof message === 'string' ? message : REDACTION_FAILED;
    } catch {
      return REDACTION_FAILED;
    }
  }

  /** Redacts the `error` text of a failed tool's result, which is a thrown error's message. */
  private redactToolFailure(result: unknown): unknown {
    if (!this.redactError || typeof result !== 'object' || result === null) return result;
    const failure = result as { status?: unknown; error?: unknown };
    return failure.status === 'error' && typeof failure.error === 'string'
      ? { ...failure, error: this.redactText(failure.error) }
      : result;
  }

  private async dispatch<K extends keyof AgentObserver>(
    hook: K,
    event: Parameters<ObserverMethod<K>>[0],
  ): Promise<void> {
    const tasks = this.observers.map(async (observer) => {
      const fn = observer[hook] as ObserverMethod<K> | undefined;
      if (typeof fn === 'function') {
        try {
          await fn.call(observer, event as never);
        } catch (err: unknown) {
          if (process.env.OBSERVER_LOG_DEBUG === 'true') {
            console.warn(`[ObserverNotifier] Error in ${hook}:`, err);
          }
        }
      }
    });

    // allSettled never rejects, so leaving it running unawaited cannot raise an
    // unhandled rejection.
    const settled = Promise.allSettled(tasks).then(() => undefined);
    if (this.timeoutMs === undefined) {
      await settled;
      return;
    }
    if (this.timeoutMs === 0) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.timeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([settled, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
