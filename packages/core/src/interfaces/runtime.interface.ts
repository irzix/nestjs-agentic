import type { AgentStreamEvent } from './agent-stream.interface';
import type { ResolvedTool, ToolCallRecord } from './tool.interface';

export interface ModelConfig {
  provider: 'google' | 'openai' | 'anthropic' | (string & {});
  model: string;
}

export interface AgentRunInput {
  sessionId: string;
  message: string;
  tools: ResolvedTool[];
  model: ModelConfig;
  instructions?: string;
}

export interface AgentResult {
  sessionId: string;
  output: string;
  toolCalls: ToolCallRecord[];
}

/**
 * Pluggable bridge between the core agent runner and a specific LLM runtime.
 * Implementations must not contain any policy or approval logic.
 */
export interface RuntimeAdapter {
  execute(input: AgentRunInput): Promise<AgentResult>;
  /** Optional structured event streaming support. */
  stream?(input: AgentRunInput): AsyncIterable<AgentStreamEvent>;
}
