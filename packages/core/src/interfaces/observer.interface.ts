import type { AgentResult, ModelConfig } from './runtime.interface';
import type { ModelMessage, ModelResponse, ModelUsage } from './model.interface';
import type { AgentContext } from './agent-context.interface';

/**
 * Event dispatched when an agent execution turn begins.
 */
export interface AgentStartEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  tenantId?: string;
  userId?: string;
  message?: string;
  timestamp: Date;
  context?: AgentContext;
}

/**
 * Event dispatched when an agent execution turn completes successfully or suspends for approval.
 */
export interface AgentEndEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  tenantId?: string;
  result: AgentResult;
  durationMs: number;
  totalTokensUsed?: number;
  timestamp: Date;
  context?: AgentContext;
}

/**
 * Event dispatched immediately before a request is sent to the model adapter.
 */
export interface ModelRequestEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  model: ModelConfig;
  roundIndex: number;
  messages: ModelMessage[];
  timestamp: Date;
}

/**
 * Event dispatched after a response is received from the model adapter.
 */
export interface ModelResponseEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  model: ModelConfig;
  roundIndex: number;
  response: ModelResponse;
  usage?: ModelUsage;
  durationMs: number;
  timestamp: Date;
}

/**
 * Event dispatched before a tool method is executed.
 */
export interface ToolCallEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Event dispatched after a tool method completes execution.
 */
export interface ToolResultEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  toolName: string;
  toolCallId: string;
  result: unknown;
  durationMs: number;
  timestamp: Date;
}

/**
 * Event dispatched when an uncaught error occurs during agent execution.
 */
export interface AgentErrorEvent {
  agentName: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
  rootTraceId?: string;
  error: Error;
  durationMs: number;
  timestamp: Date;
  context?: AgentContext;
}

/**
 * Event dispatched when a failed model call is about to be retried.
 */
export interface ModelRetryEvent {
  agentName?: string;
  sessionId?: string;
  traceId?: string;
  /** 1-based number of the attempt that failed. */
  attempt: number;
  maxAttempts: number;
  /** Delay before the next attempt, after jitter. */
  delayMs: number;
  error: unknown;
  timestamp: Date;
}

/**
 * Event dispatched when a model call's circuit breaker changes state.
 */
export interface CircuitBreakerEvent {
  /** Identifies the guarded dependency. */
  circuitName: string;
  from: 'closed' | 'open' | 'half_open';
  to: 'closed' | 'open' | 'half_open';
  /** Consecutive failures recorded at the transition. */
  failures: number;
  reason: string;
  timestamp: Date;
}

/**
 * Observer contract for runtime telemetry, OpenTelemetry tracing, and metric collection.
 * All methods are optional and error-isolated.
 */
export interface AgentObserver {
  onAgentStart?(event: AgentStartEvent): void | Promise<void>;
  onAgentEnd?(event: AgentEndEvent): void | Promise<void>;
  onModelRequest?(event: ModelRequestEvent): void | Promise<void>;
  onModelResponse?(event: ModelResponseEvent): void | Promise<void>;
  onModelRetry?(event: ModelRetryEvent): void | Promise<void>;
  onCircuitStateChange?(event: CircuitBreakerEvent): void | Promise<void>;
  onToolCall?(event: ToolCallEvent): void | Promise<void>;
  onToolResult?(event: ToolResultEvent): void | Promise<void>;
  onError?(event: AgentErrorEvent): void | Promise<void>;
}
