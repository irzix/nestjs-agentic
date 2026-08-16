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

export type AnyObserverEvent =
  | { type: 'agent_start'; event: AgentStartEvent }
  | { type: 'agent_end'; event: AgentEndEvent }
  | { type: 'model_request'; event: ModelRequestEvent }
  | { type: 'model_response'; event: ModelResponseEvent }
  | { type: 'tool_call'; event: ToolCallEvent }
  | { type: 'tool_result'; event: ToolResultEvent }
  | { type: 'agent_error'; event: AgentErrorEvent };

export interface InMemoryAgentObserverOptions {
  /** Maximum number of records to retain per event array to prevent memory leaks. Defaults to 1000. */
  maxEvents?: number;
}

/**
 * In-memory AgentObserver implementation for testing, validation, and local inspection.
 * Includes configurable maximum event bounds with FIFO eviction.
 */
export class InMemoryAgentObserver implements AgentObserver {
  readonly startEvents: AgentStartEvent[] = [];
  readonly endEvents: AgentEndEvent[] = [];
  readonly modelRequestEvents: ModelRequestEvent[] = [];
  readonly modelResponseEvents: ModelResponseEvent[] = [];
  readonly toolCallEvents: ToolCallEvent[] = [];
  readonly toolResultEvents: ToolResultEvent[] = [];
  readonly errorEvents: AgentErrorEvent[] = [];
  readonly allEvents: AnyObserverEvent[] = [];

  readonly maxEvents: number;

  constructor(options: InMemoryAgentObserverOptions = {}) {
    this.maxEvents = options.maxEvents ?? 1000;
  }

  onAgentStart(event: AgentStartEvent): void {
    this.pushEvent(this.startEvents, event);
    this.pushEvent(this.allEvents, { type: 'agent_start', event });
  }

  onAgentEnd(event: AgentEndEvent): void {
    this.pushEvent(this.endEvents, event);
    this.pushEvent(this.allEvents, { type: 'agent_end', event });
  }

  onModelRequest(event: ModelRequestEvent): void {
    this.pushEvent(this.modelRequestEvents, event);
    this.pushEvent(this.allEvents, { type: 'model_request', event });
  }

  onModelResponse(event: ModelResponseEvent): void {
    this.pushEvent(this.modelResponseEvents, event);
    this.pushEvent(this.allEvents, { type: 'model_response', event });
  }

  onToolCall(event: ToolCallEvent): void {
    this.pushEvent(this.toolCallEvents, event);
    this.pushEvent(this.allEvents, { type: 'tool_call', event });
  }

  onToolResult(event: ToolResultEvent): void {
    this.pushEvent(this.toolResultEvents, event);
    this.pushEvent(this.allEvents, { type: 'tool_result', event });
  }

  onError(event: AgentErrorEvent): void {
    this.pushEvent(this.errorEvents, event);
    this.pushEvent(this.allEvents, { type: 'agent_error', event });
  }

  clear(): void {
    this.startEvents.length = 0;
    this.endEvents.length = 0;
    this.modelRequestEvents.length = 0;
    this.modelResponseEvents.length = 0;
    this.toolCallEvents.length = 0;
    this.toolResultEvents.length = 0;
    this.errorEvents.length = 0;
    this.allEvents.length = 0;
  }

  private pushEvent<T>(arr: T[], item: T): void {
    arr.push(item);
    if (arr.length > this.maxEvents) {
      arr.shift();
    }
  }
}
