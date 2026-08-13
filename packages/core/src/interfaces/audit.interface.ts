import type { AgentContext } from './agent-context.interface';

/**
 * Who performed an audited action.
 *
 * The framework never infers this. Identity is application-owned, so a human
 * decision carries whatever identity the application passes to
 * `ApprovalService.approve()` / `.reject()`. An event recorded without an actor
 * still proves *what* happened, but not *who* did it.
 */
export interface AuditActor {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  /**
   * Label for a non-user actor, such as `'ops-console'`, `'slack-approval-bot'`,
   * or `'scheduled-cleanup'`.
   */
  label?: string;
}

/** Fields recorded on every audit event. */
export interface AuditEventBase {
  /** When the framework recorded the event. */
  at: Date;
  sessionId: string;
  traceId: string;
  /** Tenant the execution belonged to, when the application set one. */
  tenantId?: string;
}

/**
 * A governed tool call crossed the policy boundary.
 *
 * `allow` decisions are omitted by default because every framework-managed tool
 * call produces one; enable `audit.includeAllowDecisions` to record them too.
 */
export interface ToolPolicyDecisionAuditEvent extends AuditEventBase {
  type: 'tool_policy_decision';
  agentName: string;
  toolName: string;
  /** Policy class that produced the decision. */
  policyName: string;
  decision: 'allow' | 'deny' | 'require_approval';
  reason?: string;
  /** Set when the decision created a pending approval. */
  approvalId?: string;
  /** Present only when `audit.includeArgs` is enabled, with sensitive fields masked. */
  args?: Record<string, unknown>;
}

/** A tool call was withheld and a pending approval was created. */
export interface ApprovalRequestedAuditEvent extends AuditEventBase {
  type: 'approval_requested';
  approvalId: string;
  agentName: string;
  toolName: string;
  reason: string;
  /** When the approval stops being resolvable, if it has a lifetime. */
  expiresAt?: Date;
  args?: Record<string, unknown>;
}

/** A human resolved a pending approval, and the outcome was applied. */
export interface ApprovalSettledAuditEvent extends AuditEventBase {
  type: 'approval_settled';
  approvalId: string;
  agentName: string;
  toolName: string;
  outcome: 'approved' | 'rejected';
  /** Who made the decision, when the application supplied it. */
  actor?: AuditActor;
  /** Rejection reason, or the reason approval was required. */
  reason?: string;
  args?: Record<string, unknown>;
}

/** A settlement was refused because the approval had already expired. */
export interface ApprovalExpiredAuditEvent extends AuditEventBase {
  type: 'approval_expired';
  approvalId: string;
  agentName: string;
  toolName: string;
  expiredAt: Date;
  /** Who attempted the late decision, when the application supplied it. */
  actor?: AuditActor;
}

/**
 * A settlement failed after the approval was already claimed.
 *
 * This is the state worth alerting on: the approval is consumed, so it cannot be
 * retried, and the tool may have applied part of its side effect before failing.
 */
export interface ApprovalSettlementFailedAuditEvent extends AuditEventBase {
  type: 'approval_settlement_failed';
  approvalId: string;
  agentName: string;
  toolName: string;
  outcome: 'approved' | 'rejected';
  error: string;
  actor?: AuditActor;
}

/** Any event the framework records on the governance boundary. */
export type AuditEvent =
  | ToolPolicyDecisionAuditEvent
  | ApprovalRequestedAuditEvent
  | ApprovalSettledAuditEvent
  | ApprovalExpiredAuditEvent
  | ApprovalSettlementFailedAuditEvent;

/**
 * Destination for audit events.
 *
 * Register one or more through the `AUDIT_SINKS` token. A sink that throws or
 * rejects is isolated: the governed operation continues, because failing a
 * refund because a log server is unreachable is worse than losing the entry.
 * Sinks that must not lose events should buffer durably themselves.
 */
export interface AuditSink {
  record(event: AuditEvent): void | Promise<void>;
}

/** Recording behavior for the audit trail. */
export interface AuditOptions {
  /**
   * Include tool arguments on recorded events. Off by default: arguments can
   * carry secrets and personal data, and an audit store usually has a longer
   * retention than application logs.
   */
  includeArgs?: boolean;
  /**
   * Argument field names to mask when `includeArgs` is enabled. Nested objects
   * are masked recursively.
   */
  sensitiveFields?: string[];
  /**
   * Record `allow` policy decisions too. Off by default, because every
   * framework-managed tool call produces one and that volume belongs to tracing
   * rather than an audit trail.
   */
  includeAllowDecisions?: boolean;
}

/** Builds the shared envelope for an event from the execution context. */
export function auditEnvelope(context: AgentContext): AuditEventBase {
  return {
    at: new Date(),
    sessionId: context.sessionId,
    traceId: context.traceId,
    tenantId: context.security.tenantId,
  };
}
