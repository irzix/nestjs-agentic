import type { ToolExecutionResult } from './tool.interface';
import type { ModelUsage } from './model.interface';

/**
 * Event emitted during streamed execution of an agent turn.
 * 
 * Implements the formal ReAct (Reasoning and Acting) event lifecycle:
 * Thought ➔ Action (call) ➔ Observation (result) ➔ Final Answer
 * 
 * @see Yao et al. (Princeton & Google Brain, ICLR 2023, arXiv:2210.03629)
 */
export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'thought'; thought: string }
  | { type: 'action_call'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'action_observation'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'final_answer'; sessionId: string; output: string; usage?: ModelUsage }
  // Backwards-compatible aliases
  | { type: 'tool_start'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'approval_required'; id?: string; toolName: string; approvalId: string; reason: string }
  | { type: 'tool_error'; id?: string; toolName: string; error: string }
  | { type: 'complete'; sessionId: string; output: string };
