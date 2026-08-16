# ADR 003: Deterministic Governance, Durable Redis Checkpoints, and HITL Approvals

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
When Njent generates automated code fixes (`@njent apply-fixes`), it must execute side-effecting operations: creating git branches, committing files, and opening pull requests.

Autonomous code modification without strict governance introduces severe production risks:
1. **Accidental Corruption:** The AI might overwrite sensitive workflows (`.github/workflows/`), security configurations, or licensing files.
2. **Duplicate Side-Effects on Webhook Retries:** GitHub retries webhooks on temporary network glitches, potentially causing duplicate comments or duplicate git branches.
3. **Loss of In-Flight State During Human Waiting:** If an agent waits in-memory for hours for a maintainer to approve a commit, server restarts or Kubernetes pod rescheduling destroy the execution state.

---

## Decision
We choose **Deterministic Code Policies (`@UsePolicies`)**, **Durable Redis Checkpoint Suspensions**, and **Atomic `NX` Idempotency Locking**.

```
                           ┌───────────────────────────┐
                           │ @njent apply-fixes Action │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │   RedisIdempotencyStore   │
                           │   (SET key NX EX 1800)    │
                           └─────────────┬─────────────┘
                                         │
                       ┌─────────────────┴─────────────────┐
                 [Duplicate Key]                     [Claimed Key]
                       ▼                                   ▼
              Return Cached Result               Execute Code Fixer Agent
                                                           │
                                                           ▼
                                                 ┌───────────────────┐
                                                 │ Tool Execution:   │
                                                 │ git_commit_push   │
                                                 └─────────┬─────────┘
                                                           │
                                                           ▼
                                                 ┌───────────────────┐
                                                 │ RequireMaintainer │
                                                 │ ApprovalPolicy    │
                                                 └─────────┬─────────┘
                                                           │
                                                           ▼
                                                 ┌───────────────────┐
                                                 │ Save Checkpoint to│
                                                 │ RedisApprovalStore│
                                                 │ (action: suspended│
                                                 └─────────┬─────────┘
                                                           │
                                                           ▼
                                                 ┌───────────────────┐
                                                 │ Zero Pod Memory;  │
                                                 │ Await Maintainer  │
                                                 │ Settle POST API   │
                                                 └───────────────────┘
```

### Key Technical Choices:
1. **Deterministic Code Policy Boundaries:**
   * `RequireMaintainerApprovalPolicy`: Forces all branch creation, commit pushes, and PR merges to return `require_approval`.
   * `ProtectedPathsPolicy`: Code-level blocklist (`.github/workflows/`, `package.json`, `SECURITY.md`) that denies modifications regardless of prompt instructions.
2. **Durable Redis Checkpoint Suspension:**
   * When suspended, an immutable `ApprovalCheckpoint` is stored in Redis with a 24-hour TTL (`86400s`).
   * The NestJS execution turn exits immediately, freeing all RAM, CPU, and worker threads.
3. **Atomic Resumption API:**
   * Maintainers settle the approval via a secure REST endpoint (`POST /approvals/:id/settle`).
   * Upon approval, `AgentRunner.resumeTurn(approval)` reconstitutes the exact turn state and executes the tool.
4. **Idempotency with Redis `NX`:**
   * Webhook delivery keys are claimed atomically: `SET idempotency:<sha256> in_progress EX 1800 NX`.
   * Concurrent or retried webhooks are immediately deduplicated without re-executing LLM turns.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Autonomous Commits (No HITL)** | Fully automatic without human intervention. | Extreme risk of destructive repository changes, CI breakages, or malicious code injection. |
| **System Prompt Warnings (e.g. "Do not modify CI files")** | Zero code changes. | Vulnerable to prompt injection and jailbreaks; non-deterministic. |
| **In-Memory Suspensions (Node.js Promises)** | Simple async/await code. | Memory leaks; state is lost instantly upon server redeployments or container restarts. |

---

## Consequences & Trade-offs
* **Positive:** 100% human-governed mutations; zero risk of CI script corruption; resilient to server restarts; zero duplicate side-effects.
* **Negative:** Requires Redis infrastructure; requires maintainer interaction to settle approvals.
