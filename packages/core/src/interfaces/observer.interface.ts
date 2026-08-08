import type { AgentResult } from './runtime.interface';

/**
 * Observer hooks fired by AgentRunner during execution.
 * All methods are optional — implement only what you need.
 * @future Implementation planned for v0.3 (OpenTelemetry, Langfuse).
 */
export interface AgentObserver {
  onAgentStart?(agentName: string, sessionId: string): void;
  onAgentEnd?(agentName: string, result: AgentResult): void;
  onToolCall?(toolName: string, args: Record<string, unknown>): void;
  onToolResult?(toolName: string, result: unknown, durationMs: number): void;
  onError?(agentName: string, error: Error): void;
}
