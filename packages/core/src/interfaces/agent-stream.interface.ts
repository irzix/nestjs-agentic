import type { ToolExecutionResult } from './tool.interface';
import type { ModelUsage } from './model.interface';

/**
 * Event emitted during streamed execution of an agent turn.
 * 
 * Implements the formal ReAct (Reasoning and Acting) event lifecycle:
 * Thought ➔ Action (call) ➔ Observation (result) ➔ Final Answer
 *
 * ### Deduplication & Backward Compatibility:
 * For full backward compatibility with pre-0.6 consumers, the runtime dual-emits:
 * - `tool_start` alongside `action_call` (sharing the same `id`)
 * - `tool_result` alongside `action_observation` (sharing the same `id`)
 * - `final_answer` alongside `complete` (sharing the same `sessionId`)
 *
 * Sinks and UI consumers can correlate or deduplicate events using the shared `id`.
 * 
 * @see Yao et al. (Princeton & Google Brain, ICLR 2023, arXiv:2210.03629)
 */
export type AgentStreamEvent =
  // Formal ReAct Lifecycle Events
  | { type: 'thought'; thought: string }
  | { type: 'action_call'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'action_observation'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'final_answer'; sessionId: string; output: string; usage?: ModelUsage }
  // Token Streaming
  | { type: 'token'; text: string }
  // Governance & Approvals
  | { type: 'approval_required'; id?: string; toolName: string; approvalId: string; reason: string }
  // Backwards-Compatible Aliases
  | { type: 'tool_start'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'tool_error'; id?: string; toolName: string; error: string }
  | { type: 'complete'; sessionId: string; output: string };
