import type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentObserver,
  AgentStartEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../interfaces/observer.interface';

/**
 * Dispatches runtime observer lifecycle hooks with complete error isolation.
 * Observers are executed concurrently using Promise.allSettled so that a slow or
 * failing observer never throws or disrupts the primary agent execution.
 */
export class ObserverNotifier {
  private readonly observers: AgentObserver[];

  constructor(observers: AgentObserver[] = []) {
    this.observers = observers.filter(Boolean);
  }

  get length(): number {
    return this.observers.length;
  }

  get isEnabled(): boolean {
    return this.observers.length > 0;
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
    event: Parameters<NonNullable<AgentObserver[K]>>[0],
  ): Promise<void> {
    const tasks = this.observers.map(async (observer) => {
      const fn = observer[hook];
      if (typeof fn === 'function') {
        try {
          await (fn as (e: unknown) => unknown).call(observer, event);
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
