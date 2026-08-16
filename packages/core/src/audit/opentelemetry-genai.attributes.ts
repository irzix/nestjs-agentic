import type { AuditEvent } from '../interfaces/audit.interface';

/**
 * Standard OpenTelemetry Semantic Conventions for Generative AI Systems (v1.28.0+).
 * 
 * Conforms directly to the CNCF OpenTelemetry GenAI Semantic Conventions specification:
 * - gen_ai.system, gen_ai.request.model, gen_ai.response.model, gen_ai.operation.name
 * - gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, gen_ai.usage.total_tokens
 * - gen_ai.agent.name, gen_ai.session.id, gen_ai.trace.id
 *
 * @see CNCF / OpenTelemetry GenAI Specification (v1.28.0+): https://opentelemetry.io/docs/specs/semconv/gen-ai/
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
  APPROVAL_OUTCOME: 'gen_ai.approval.outcome',
  ERROR_MESSAGE: 'gen_ai.error.message',
} as const;

/**
 * Options for converting framework AuditEvents to OpenTelemetry GenAI semantic attributes.
 */
export interface ToOpenTelemetryAttributesOptions {
  /** Override the default system identifier. Default: `'nestjs-agentic'` */
  system?: string;
}

/**
 * Translates a framework AuditEvent into standard OpenTelemetry GenAI semantic attributes,
 * mapping model identity and token accounting metrics.
 *
 * @param event - The framework audit event to convert.
 * @param options - Optional configuration overrides (e.g. system name).
 * @returns Key-value dictionary conforming to OpenTelemetry GenAI semantic conventions.
 */
export function toOpenTelemetryGenAiAttributes(
  event: AuditEvent,
  options?: ToOpenTelemetryAttributesOptions,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    [OpenTelemetryGenAiConventions.SYSTEM]: options?.system ?? 'nestjs-agentic',
    [OpenTelemetryGenAiConventions.SESSION_ID]: event.sessionId,
    [OpenTelemetryGenAiConventions.TRACE_ID]: event.traceId,
  };

  if (event.tenantId) {
    attributes[OpenTelemetryGenAiConventions.TENANT_ID] = event.tenantId;
  }

  // Map Model attributes if present
  const eventRecord = event as unknown as Record<string, unknown>;
  const modelName = (eventRecord.model ?? eventRecord.genAiModel ?? eventRecord.requestModel) as string | undefined;
  if (modelName) {
    attributes[OpenTelemetryGenAiConventions.REQUEST_MODEL] = modelName;
    attributes[OpenTelemetryGenAiConventions.RESPONSE_MODEL] = modelName;
  }

  // Map Token Usage attributes if present
  const usageRecord = (eventRecord.usage && typeof eventRecord.usage === 'object')
    ? (eventRecord.usage as Record<string, unknown>)
    : undefined;
  const inputTokens = (usageRecord?.inputTokens ?? usageRecord?.promptTokens ?? eventRecord.promptTokens) as number | undefined;
  const outputTokens = (usageRecord?.outputTokens ?? usageRecord?.completionTokens ?? eventRecord.completionTokens) as number | undefined;
  const totalTokens = (usageRecord?.totalTokens ?? eventRecord.totalTokens ?? (
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined
  )) as number | undefined;

  if (inputTokens !== undefined) {
    attributes[OpenTelemetryGenAiConventions.USAGE_INPUT_TOKENS] = inputTokens;
    attributes[OpenTelemetryGenAiConventions.USAGE_PROMPT_TOKENS] = inputTokens;
  }
  if (outputTokens !== undefined) {
    attributes[OpenTelemetryGenAiConventions.USAGE_OUTPUT_TOKENS] = outputTokens;
    attributes[OpenTelemetryGenAiConventions.USAGE_COMPLETION_TOKENS] = outputTokens;
  }
  if (totalTokens !== undefined) {
    attributes[OpenTelemetryGenAiConventions.USAGE_TOTAL_TOKENS] = totalTokens;
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
      attributes[OpenTelemetryGenAiConventions.APPROVAL_OUTCOME] = event.outcome;
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
      attributes[OpenTelemetryGenAiConventions.ERROR_MESSAGE] = event.error;
      break;
  }

  return attributes;
}
