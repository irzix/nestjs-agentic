---
'@nestjs-agentic/core': minor
---

Record an auditable trail of governance decisions, including who approved.

The framework gated sensitive tool calls but kept no record of it. Nothing captured that a call was denied, that an approval was requested, or who eventually approved it — so the governance boundary could not be reviewed after the fact. `AgentObserver` existed as an interface but was never called by the runtime.

- adds `AuditSink`, a destination for `AuditEvent`s, registered through `auditSinks` on `AgenticModule.forRoot()` or the `AUDIT_SINKS` token. Auditing is opt-in: with no sink, nothing is recorded.
- adds the `AuditTrail` service as the single choke point that applies filtering and redaction, so no call site can bypass them
- records five events: `tool_policy_decision`, `approval_requested`, `approval_settled`, `approval_expired`, and `approval_settlement_failed`
- `ApprovalService.approve()` / `.reject()` now accept an `actor` describing who is deciding, since identity is application-owned and the framework will not infer it
- ships `InMemoryAuditSink` for tests and local inspection, and `ConsoleAuditSink` for log-pipeline deployments

`approval_settlement_failed` covers the case worth alerting on: the tool failed *after* the approval was claimed, so it cannot be retried and part of the side effect may already have applied.

Three defaults are deliberate:

- tool arguments are **withheld** unless `audit.includeArgs` is enabled, because they can carry secrets and personal data into a store that typically outlives application logs. `audit.sensitiveFields` masks named fields, including nested ones.
- `allow` decisions are **not recorded** unless `audit.includeAllowDecisions` is enabled, since every framework-managed call produces one and that volume belongs to tracing.
- a sink that throws is **isolated**. Failing an already-approved refund because a log store is unreachable is worse than losing the entry, so a sink that must not lose events should buffer durably itself.

Model and tool execution traces and metrics are not included; those remain part of the observability milestone.

No breaking changes. `actor`, `auditSinks`, and `audit` are optional, the new `AuditTrail` constructor parameters on `ApprovalService` and `LocalToolProvider` are optional and last, and applications that register no sink behave exactly as before.
