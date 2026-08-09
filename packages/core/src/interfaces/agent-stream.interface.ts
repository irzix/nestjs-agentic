import type { ToolExecutionResult } from './tool.interface';

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolExecutionResult }
  | { type: 'approval_required'; toolName: string; approvalId: string; reason: string }
  | { type: 'complete'; sessionId: string; output: string };
