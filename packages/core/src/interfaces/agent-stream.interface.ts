import type { ToolExecutionResult } from './tool.interface';

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'approval_required'; id?: string; toolName: string; approvalId: string; reason: string }
  /**
   * A tool threw instead of returning a result. The runtime reports the failure
   * to the model and continues the turn, so this is a terminal event for the
   * tool call rather than for the run.
   */
  | { type: 'tool_error'; id?: string; toolName: string; error: string }
  | { type: 'complete'; sessionId: string; output: string };
