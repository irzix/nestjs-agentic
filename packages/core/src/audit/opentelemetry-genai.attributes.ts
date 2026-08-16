import type { AuditEvent } from '../interfaces/audit.interface';

/**
 * Standard OpenTelemetry Semantic Conventions for Generative AI Systems.
 * 
 * @see CNCF / OpenTelemetry GenAI Specification: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @see Pillar 10 (Observability & Monitoring): specs/10-observability-and-monitoring.spec.md
 */
export const OpenTelemetryGenAiConventions = {
  // System & Model
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  OPERATION_NAME: 'gen_ai.operation.name',

  // Usage & Accounting
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
  USAGE_PROMPT_TOKENS: 'gen_ai.usage.prompt_tokens',
  USAGE_COMPLETION_TOKENS: 'gen_ai.usage.completion_tokens',

  // Agent & Execution Identity
  AGENT_NAME: 'gen_ai.agent.name',
  SESSION_ID: 'gen_ai.session.id',
  TRACE_ID: 'gen_ai.trace.id',
  TENANT_ID: 'gen_ai.tenant.id',
  USER_ID: 'gen_ai.user.id',

  // Tool & Action Governance
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call_id',
  TOOL_STATUS: 'gen_ai.tool.status',

  // Policy & Guardrails Boundary
  POLICY_NAME: 'gen_ai.policy.name',
  POLICY_DECISION: 'gen_ai.policy.decision',
  APPROVAL_ID: 'gen_ai.approval.id',
} as const;

/**
 * Translates a framework AuditEvent into standard OpenTelemetry GenAI semantic attributes.
 *
 * @param event - The framework audit event to convert.
 * @returns Key-value dictionary conforming to OpenTelemetry GenAI semantic conventions.
 */
export function toOpenTelemetryGenAiAttributes(event: AuditEvent): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    [OpenTelemetryGenAiConventions.SYSTEM]: 'nestjs-agentic',
    [OpenTelemetryGenAiConventions.SESSION_ID]: event.sessionId,
    [OpenTelemetryGenAiConventions.TRACE_ID]: event.traceId,
  };

  if (event.tenantId) {
    attributes[OpenTelemetryGenAiConventions.TENANT_ID] = event.tenantId;
  }

  switch (event.type) {
    case 'tool_policy_decision':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'tool_policy_evaluation';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.POLICY_NAME] = event.policyName;
      attributes[OpenTelemetryGenAiConventions.POLICY_DECISION] = event.decision;
      if (event.approvalId) {
        attributes[OpenTelemetryGenAiConventions.APPROVAL_ID] = event.approvalId;
      }
      break;

    case 'tool_output_policy_decision':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'tool_output_rail_evaluation';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.POLICY_NAME] = event.policyName;
      attributes[OpenTelemetryGenAiConventions.POLICY_DECISION] = event.decision;
      break;

    case 'approval_requested':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'approval_requested';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.APPROVAL_ID] = event.approvalId;
      break;

    case 'approval_settled':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'approval_settled';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.APPROVAL_ID] = event.approvalId;
      attributes['gen_ai.approval.outcome'] = event.outcome;
      if (event.actor?.userId) {
        attributes[OpenTelemetryGenAiConventions.USER_ID] = event.actor.userId;
      }
      break;

    case 'approval_expired':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'approval_expired';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.APPROVAL_ID] = event.approvalId;
      break;

    case 'approval_settlement_failed':
      attributes[OpenTelemetryGenAiConventions.OPERATION_NAME] = 'approval_settlement_failed';
      attributes[OpenTelemetryGenAiConventions.AGENT_NAME] = event.agentName;
      attributes[OpenTelemetryGenAiConventions.TOOL_NAME] = event.toolName;
      attributes[OpenTelemetryGenAiConventions.APPROVAL_ID] = event.approvalId;
      attributes['gen_ai.error.message'] = event.error;
      break;
  }

  return attributes;
}
