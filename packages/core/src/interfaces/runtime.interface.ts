import type { ResolvedTool, ToolCallRecord } from './tool.interface';
import type { AgentStreamEvent } from './agent-stream.interface';
import type { ModelUsage } from './model.interface';

/** Known LLM provider identifiers with extensibility for custom adapters. */
export type ModelProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'azure'
  | 'groq'
  | 'bedrock'
  | (string & {});

export interface ModelConfig {
  provider?: ModelProviderName;
  model: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
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
  usage?: ModelUsage;
  /** Wall-clock duration of a completed run when measured by the runner. */
  durationMs?: number;
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
