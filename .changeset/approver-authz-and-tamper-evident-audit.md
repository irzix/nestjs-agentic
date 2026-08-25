---
"@nestjs-agentic/core": minor
---

Add approver authorization for pending approvals. `ApprovalService` now consults an optional `ApprovalAuthorizer` (registered through the new `APPROVAL_AUTHORIZER` token) before an approval is claimed, so a refused attempt leaves the approval pending instead of consuming it. A new `AgenticModuleOptions.approvals.enforceSeparationOfDuties` flag refuses a settlement when the approver is the same identity that triggered the action; `PendingApproval` now carries `requestedBy`, stamped from the execution context at creation. Refused attempts raise `ApprovalNotAuthorizedError` and are recorded as a new `approval_settlement_denied` audit event.

Optional and backward compatible: with no authorizer registered and separation of duties disabled, settlement behavior is unchanged.

Part of #139.
