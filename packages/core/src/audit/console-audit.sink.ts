import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';

export interface ConsoleAuditSinkOptions {
  /** Receives the formatted line and the event. Defaults to `console.log`. */
  logger?(message: string, event: AuditEvent): void;
}

/**
 * Writes audit events as single log lines.
 *
 * Useful for development and for deployments that ship stdout to a log
 * pipeline. It is not a queryable audit store: retention, ordering, and
 * tamper-resistance are whatever the surrounding log system provides.
 */
export class ConsoleAuditSink implements AuditSink {
  private readonly logger: (message: string, event: AuditEvent) => void;

  constructor(options?: ConsoleAuditSinkOptions) {
    this.logger = options?.logger ?? ((message, event) => console.log(message, event));
  }

  record(event: AuditEvent): void {
    this.logger(`[audit] ${event.type} ${summarize(event)}`, event);
  }
}

/** Builds a short, greppable description of the decision. */
function summarize(event: AuditEvent): string {
  switch (event.type) {
    case 'tool_policy_decision':
      return `${event.toolName} ${event.decision} by ${event.policyName}`;
    case 'tool_output_policy_decision':
      return `${event.toolName} output ${event.decision} by ${event.policyName}`;
    case 'approval_requested':
      return `${event.toolName} approval ${event.approvalId}`;
    case 'approval_settled':
      return `${event.toolName} ${event.outcome} approval ${event.approvalId}${
        event.actor ? ` by ${describeActor(event.actor)}` : ''
      }`;
    case 'approval_expired':
      return `${event.toolName} approval ${event.approvalId} expired at ${event.expiredAt.toISOString()}`;
    case 'approval_settlement_failed':
      return `${event.toolName} approval ${event.approvalId} failed after claim: ${event.error}`;
    case 'approval_settlement_denied':
      return `${event.toolName} approval ${event.approvalId} ${event.outcome} attempt refused${
        event.actor ? ` for ${describeActor(event.actor)}` : ''
      }: ${event.reason}`;
  }
}

function describeActor(actor: { userId?: string; label?: string }): string {
  return actor.userId ?? actor.label ?? 'unknown actor';
}
