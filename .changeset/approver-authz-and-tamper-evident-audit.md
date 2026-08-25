---
"@nestjs-agentic/core": minor
---

Add approver authorization for pending approvals. `ApprovalService` now consults an optional `ApprovalAuthorizer` (registered through the new `APPROVAL_AUTHORIZER` token) before an approval is claimed, so a refused attempt leaves the approval pending instead of consuming it. Refusals raise `ApprovalNotAuthorizedError` and are recorded as a new `approval_settlement_denied` audit event.

Three opt-in governance flags under `AgenticModuleOptions.approvals`:

- `enforceSeparationOfDuties` — refuses a settlement when the approver is the identity that triggered the action. Tenant-scoped, so the same `userId` in two tenants is not treated as a conflict.
- `enforceTenantIsolation` — refuses a settlement whose approver is not in the approval's tenant, so a leaked approval ID cannot be settled cross-tenant.
- `requireAuthorizer` — refuses every settlement unless an authorizer is registered, letting a deployment fail closed.

`PendingApproval` now carries `requestedBy`, stamped from the execution context at creation. All flags default to off, so settlement behavior is unchanged without configuration.

Part of #139.
