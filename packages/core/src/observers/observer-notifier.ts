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
}

/**
 * Dispatches runtime observer lifecycle hooks with complete error isolation.
 * Observers are executed concurrently using Promise.allSettled so that a slow or
 * failing observer never throws or disrupts the primary agent execution.
 */
export class ObserverNotifier {
  private readonly observers: AgentObserver[];
  private readonly samplingRate: number;
  private readonly isSampled: boolean;

  constructor(
    observers: AgentObserver[] = [],
    options: ObserverNotifierOptions = {},
  ) {
    this.observers = observers.filter(Boolean);
    const rate = options.samplingRate ?? 1.0;
    this.samplingRate = Math.max(0, Math.min(1, rate));
    this.isSampled = this.samplingRate >= 1.0 || Math.random() < this.samplingRate;
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

    await Promise.allSettled(tasks);
  }
}
