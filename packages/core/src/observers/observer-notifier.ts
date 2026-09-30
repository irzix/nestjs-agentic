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
}

/**
 * Dispatches runtime observer lifecycle hooks with complete error isolation.
 * Observers are executed concurrently using Promise.allSettled so that a slow or
 * failing observer never throws or disrupts the primary agent execution. Set
 * `timeoutMs` so a slow observer cannot delay it either.
 */
export class ObserverNotifier {
  private readonly observers: AgentObserver[];
  private readonly samplingRate: number;
  private readonly isSampled: boolean;
  private readonly timeoutMs?: number;

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
    if (!this.isEnabled) return;
    await this.dispatch('onAgentEnd', event);
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
    if (!this.isEnabled) return;
    await this.dispatch('onModelRetry', event);
  }

  async notifyCircuitStateChange(event: CircuitBreakerEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onCircuitStateChange', event);
  }

  async notifyToolCall(event: ToolCallEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onToolCall', event);
  }

  async notifyToolResult(event: ToolResultEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onToolResult', event);
  }

  async notifyError(event: AgentErrorEvent): Promise<void> {
    if (!this.isEnabled) return;
    await this.dispatch('onError', event);
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
