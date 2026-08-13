---
'@nestjs-agentic/core': minor
---

Settle human approvals exactly once, even under concurrent calls or restart-triggered retries.

Previously `ApprovalService.approve()`/`reject()` read the pending approval, ran its withheld tool, and only then deleted the record. Two concurrent calls for the same approval — or a retry after a restart — could both observe the record and run the side effect twice, which is unsafe for the sensitive operations approvals typically guard (refunds, payments, outbound messages).

Settlement is now claim-first: the approval is removed atomically before its tool runs, so a given approval resolves at most once.

- adds `ApprovalStore.claim(id)`, an atomic remove-and-return primitive; `approve()`/`reject()` call it before executing, and callers that lose the race throw `ApprovalNotFoundError`
- `InMemoryApprovalStore.claim()` is atomic within a process; `RedisApprovalStore.claim()` uses Redis `GETDEL` for cross-instance atomicity when the client exposes it, falling back to a non-atomic get+del otherwise
- extends the optional `GenericRedisClient` contract with `getdel?(key)`

Because the claim happens before execution, a tool that fails after being claimed is not retried; end-to-end exactly-once for a side effect still depends on the tool being idempotent, tracked as follow-up idempotency-key work.

Breaking change:

- `ApprovalStore` now requires a `claim(id): Promise<PendingApproval | null>` method. Custom `ApprovalStore` implementations must add it; the built-in `InMemoryApprovalStore` and `RedisApprovalStore` already do.
