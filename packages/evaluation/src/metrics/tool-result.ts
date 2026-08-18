import type { ToolCallRecord } from '@nestjs-agentic/core';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** O(1): classifies the normalized result of one tool invocation. */
export function isToolExecutionFailed(call: ToolCallRecord): boolean {
  if (call.result instanceof Error) return true;
  if (typeof call.result === 'string') {
    const message = call.result.toLowerCase();
    return message.startsWith('error') || message.includes('failed');
  }
  if (!isRecord(call.result)) return false;
  return call.result.success === false || call.result.isError === true || call.result.error !== undefined;
}

/** O(1): produces a useful diagnostic without assuming an external result shape. */
export function getToolFailureReason(result: unknown): string {
  if (result instanceof Error) return result.message;
  if (typeof result === 'string') return result;
  if (!isRecord(result)) return 'Tool execution failure';
  const reason = result.reason ?? result.error;
  return typeof reason === 'string' ? reason : 'Tool execution failure';
}
