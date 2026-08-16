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

/**
 * In-memory AgentObserver implementation for testing, validation, and local inspection.
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

  onAgentStart(event: AgentStartEvent): void {
    this.startEvents.push(event);
    this.allEvents.push({ type: 'agent_start', event });
  }

  onAgentEnd(event: AgentEndEvent): void {
    this.endEvents.push(event);
    this.allEvents.push({ type: 'agent_end', event });
  }

  onModelRequest(event: ModelRequestEvent): void {
    this.modelRequestEvents.push(event);
    this.allEvents.push({ type: 'model_request', event });
  }

  onModelResponse(event: ModelResponseEvent): void {
    this.modelResponseEvents.push(event);
    this.allEvents.push({ type: 'model_response', event });
  }

  onToolCall(event: ToolCallEvent): void {
    this.toolCallEvents.push(event);
    this.allEvents.push({ type: 'tool_call', event });
  }

  onToolResult(event: ToolResultEvent): void {
    this.toolResultEvents.push(event);
    this.allEvents.push({ type: 'tool_result', event });
  }

  onError(event: AgentErrorEvent): void {
    this.errorEvents.push(event);
    this.allEvents.push({ type: 'agent_error', event });
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
}
