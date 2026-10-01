---
"@nestjs-agentic/core": minor
---

Add dual control (N-of-M approvals) for high-risk actions.

- A `require_approval` policy decision can set `requiredApprovals`. The withheld tool then runs only after that many distinct approvers have called `ApprovalService.approve()`. Earlier calls return a `pending_approval` result with `signatures` and `requiredApprovals`. Every signature runs through the `ApprovalAuthorizer`, tenant isolation, and separation-of-duties checks and must carry `actor.userId`. A repeated signature from the same `userId` is refused rather than counted twice, and a single authorized `reject()` vetoes.
- New optional `ApprovalStore.addSignature(id, signature)` appends a signature atomically and claims the approval on the one that meets the threshold, so exactly one caller settles it. Implemented by `InMemoryApprovalStore`, `PostgresApprovalStore`, and `RedisApprovalStore` (when the client exposes `eval`; the approval and its signatures share one key). Stores without it keep working for single-approver approvals, and a multi-approver decision on such a store is denied instead of downgraded.
- New `approval_signed` audit event per counted signature, `requiredApprovals` on `approval_requested`, and `signatures` on `approval_settled`.
- `runApprovalStoreContract` gains capability-gated groups for `addSignature`: threshold accumulation, duplicate rejection, and atomicity under concurrent signers. Its argument round-trip check no longer depends on JSON key order, which PostgreSQL `jsonb` does not preserve.
- New exports: `ApprovalSignature`, `ApprovalSignatureResult`, `ApprovalSignedAuditEvent`, `ApprovalSignaturesUnsupportedError`, `requiredApprovalsOf`.
