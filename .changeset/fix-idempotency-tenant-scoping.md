---
'@nestjs-agentic/core': patch
---

Fix `IdempotencyStore` lookups and saves in `LocalToolProvider` being keyed on the raw caller-supplied `idempotencyKey` alone, unlike `SessionStore` which already scopes by tenant. Two tenants supplying the same literal `idempotencyKey` (accidentally or deliberately) could read and cache each other's `ToolExecutionResult`, including its `data` payload — a cross-tenant data leak through a governance primitive.

- `LocalToolProvider` now namespaces every idempotency key as `` `${tenantId ?? 'default'}:${idempotencyKey}` `` before it reaches the `IdempotencyStore`, on both the normal policy-guarded tool path and the approval-resume path (`invokeApprovedTool`).
- Added a tenant-isolation assertion group to `runIdempotencyStoreContract`, mirroring the existing tenant-isolation check in `runSessionStoreContract`: two records saved under distinct tenant-scoped keys must not collide.
- Added a regression test proving two tenants using the same literal `idempotencyKey` execute and cache independently.
