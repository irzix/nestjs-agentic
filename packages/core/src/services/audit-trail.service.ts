import { Inject, Injectable, Optional } from '@nestjs/common';
import { AGENTIC_OPTIONS, AUDIT_SINKS } from '../constants';
import type { AuditEvent, AuditOptions, AuditSink } from '../interfaces/audit.interface';
import type { AgenticModuleOptions } from './agent-runner.service';

/** Replacement written in place of a masked argument value. */
const REDACTED = '***REDACTED***';

/**
 * Records governance decisions to every registered `AuditSink`.
 *
 * This is the single choke point for the audit trail, so filtering and
 * redaction cannot be forgotten at a call site. Callers build a complete event
 * with raw arguments and hand it here; what actually reaches a sink is decided
 * by `audit` options.
 *
 * Auditing is opt-in: with no sink registered, `record()` returns immediately
 * and no event is constructed downstream.
 */
@Injectable()
export class AuditTrail {
  constructor(
    @Optional() @Inject(AUDIT_SINKS) private readonly sinks?: AuditSink[],
    @Optional() @Inject(AGENTIC_OPTIONS) private readonly options?: AgenticModuleOptions,
  ) {}

  /** Whether any sink is registered. Call sites can skip building an event. */
  isEnabled(): boolean {
    return this.resolveSinks().length > 0;
  }

  /**
   * Records an event, applying the configured filtering and redaction.
   *
   * Never throws. A sink that fails is isolated so a governed operation is not
   * failed by an unreachable audit backend — losing an entry is bad, but
   * refusing an already-approved refund because a log store is down is worse.
   * Sinks that must not lose events should buffer durably themselves.
   */
  async record(event: AuditEvent): Promise<void> {
    const sinks = this.resolveSinks();
    if (sinks.length === 0) return;

    if (
      event.type === 'tool_policy_decision' &&
      event.decision === 'allow' &&
      !this.auditOptions().includeAllowDecisions
    ) {
      return;
    }

    const prepared = this.prepare(event);

    for (const sink of sinks) {
      try {
        await sink.record(prepared);
      } catch {
        // Isolated per sink, so one failing destination does not stop the others.
      }
    }
  }

  private auditOptions(): AuditOptions {
    return this.options?.audit ?? {};
  }

  private resolveSinks(): AuditSink[] {
    if (!this.sinks) return [];
    const list = Array.isArray(this.sinks) ? this.sinks.flat(Infinity) : [this.sinks];
    return list.filter((sink): sink is AuditSink => Boolean(sink));
  }

  /**
   * Applies argument policy to an event.
   *
   * Arguments are dropped unless explicitly enabled, because they can carry
   * secrets and personal data into a store that typically outlives application
   * logs.
   */
  private prepare(event: AuditEvent): AuditEvent {
    if (!('args' in event) || event.args === undefined) {
      return event;
    }

    const { includeArgs, sensitiveFields } = this.auditOptions();

    if (!includeArgs) {
      const { args: _dropped, ...rest } = event;
      return rest as AuditEvent;
    }

    if (!sensitiveFields?.length) {
      return event;
    }

    return { ...event, args: redact(event.args, new Set(sensitiveFields)) } as AuditEvent;
  }
}

/** Masks named fields, descending into nested objects. */
function redact(
  args: Record<string, unknown>,
  sensitive: Set<string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (sensitive.has(key)) {
      output[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      output[key] = redact(value as Record<string, unknown>, sensitive);
    } else {
      output[key] = value;
    }
  }

  return output;
}
