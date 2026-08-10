import type { ToolExecutionResult } from './tool.interface';

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; id?: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id?: string; toolName: string; result: ToolExecutionResult }
  | { type: 'approval_required'; id?: string; toolName: string; approvalId: string; reason: string }
  | { type: 'complete'; sessionId: string; output: string };
