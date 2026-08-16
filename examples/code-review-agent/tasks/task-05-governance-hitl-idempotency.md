# Task 05: Governance, Durable Redis Checkpoints & Idempotency

> **Implementation specification for Deterministic Policies, HITL Turn Suspension, Atomic Idempotency, and Settlement APIs.**

---

## 🎯 Objective
Implement deterministic code governance policies, Redis-backed atomic idempotency deduplication, durable `ApprovalCheckpoint` suspensions, and the REST settlement endpoint for maintainer approvals.

---

## 📁 Target Files to Create
* `src/policies/require-maintainer-approval.policy.ts`
* `src/policies/protected-paths.policy.ts`
* `src/stores/redis-idempotency.store.ts`
* `src/stores/redis-approval.store.ts`
* `src/controllers/approval.controller.ts`

---

## 📋 Detailed Technical Requirements

### 1. Deterministic Governance Policies (`src/policies/`)
* **`require-maintainer-approval.policy.ts`:**
  * Intercepts `create_fix_branch_and_commit`, `push_code_patch`, and `approve_pull_request`.
  * Returns `require_approval` decision with 24-hour TTL (`86400s`).
* **`protected-paths.policy.ts`:**
  * Denies modifications to `.github/workflows/`, `package.json`, `SECURITY.md`, and `LICENSE`.
  * Returns deterministic `deny` decision regardless of model reasoning.

### 2. Redis Idempotency Store (`src/stores/redis-idempotency.store.ts`)
* Implement `IdempotencyStore` using atomic Redis commands:
  * `claim(key, ttl)`: Executes `SET idempotency:<key> in_progress EX <ttl> NX`. Returns `'claimed'` or `'duplicate'`.
  * `set(key, record, ttl)`: Stores completed response record.
  * `get(key)`: Retrieves cached response for deduplication.

### 3. Durable Approval Suspension & Settlement API (`src/controllers/approval.controller.ts`)
* Save versioned `ApprovalCheckpoint` containing serialized session state, target tool, and validated arguments.
* Expose `POST /approvals/:id/settle`:
  * Verify maintainer authentication.
  * Update approval record status to `approved` or `rejected`.
  * If approved, resume agent execution turn via `AgentRunner.resumeTurn(approval)`.

---

## ✅ Acceptance Criteria & Testing
1. Modifying `.github/workflows/` files is blocked 100% of the time by `ProtectedPathsPolicy`.
2. Duplicate webhook triggers with the same SHA-256 key return cached results without re-executing LLM turns.
3. Suspended approvals survive process restarts in Redis and resume correctly upon approval.
4. Contract & policy tests pass: `npm run test:contracts` and `npm run test:unit -- src/policies`
