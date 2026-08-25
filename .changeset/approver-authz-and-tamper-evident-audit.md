---
"@nestjs-agentic/core": minor
---

Add approver authorization and a tamper-evident audit trail.

**Authorization.** `ApprovalService` now consults an optional `ApprovalAuthorizer` (registered through the new `APPROVAL_AUTHORIZER` token) before a pending approval is claimed, so a refused attempt leaves the approval pending instead of consuming it. A new `AgenticModuleOptions.approvals.enforceSeparationOfDuties` flag refuses a settlement when the approver is the same identity that triggered the action; `PendingApproval` now carries `requestedBy`, stamped from the execution context at creation. Refused attempts raise `ApprovalNotAuthorizedError` and are recorded as a new `approval_settlement_denied` audit event.

**Tamper-evidence.** `HashChainAuditSink` wraps an audit destination and binds every event to its predecessor (`hash_n = H(hash_{n-1} || canonical(event_n))`), with `verifyAuditChain` detecting altered, deleted, reordered, and re-linked entries. Chaining is serialized so concurrent records still verify, and a chain can be resumed across restarts. `PostgresAuditSink` ships as a real, append-only `AuditSink` that also implements `ChainedAuditEntrySink`, persisting the chain columns and exposing `head()`/`readChain()` for resumption and verification.

All additions are optional and backward compatible: with no authorizer registered and separation of duties disabled, settlement behavior is unchanged. Closes #139.
