---
'@nestjs-agentic/core': minor
---

Let human approvals expire instead of lingering forever.

An approval that is never resolved previously stayed valid indefinitely, so a decision could eventually be applied against stale context (an order, price, or balance that has since changed). Approvals can now carry a lifetime.

- `PendingApproval` gains an optional `expiresAt`. Resolving an approval after it throws the new `ApprovalExpiredError` rather than executing the decision, and the expired approval is consumed (the claim removes it) so it is not left behind for a retry.
- the TTL comes from the `require_approval` policy result's new optional `ttlSeconds`, or failing that the module-level `approvalTtlSeconds` on `AgenticModule.forRoot()`; when neither is set the approval never expires, matching prior behavior
- `RedisApprovalStore` derives the key's Redis TTL from `expiresAt` plus a configurable `expiryGraceSeconds` window (default 300s), so abandoned approvals are garbage-collected while a just-expired one can still be claimed to report the precise error. Approvals without `expiresAt` still fall back to the store's `ttlSeconds` option.

No breaking changes: `expiresAt`, `ttlSeconds`, and `approvalTtlSeconds` are all optional and default to the previous never-expire behavior.
