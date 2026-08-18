# 00 — System Requirements & User Scenarios
> **Functional Requirements, User Stories, and GitHub PR Workflows for Njent.**

---

## 1. System Overview & Personas

**Njent** is a governed, production-grade GitHub Code Review and Automated Fix Assistant built natively on `nestjs-agentic`. It serves as the primary code quality guardian on pull requests for this repository while demonstrating the **14 Core Pillars of Agentic Systems**.

### Stakeholders & Personas

| Persona | GitHub Permission | System Access & Capabilities |
|---|---|---|
| **Maintainer / Collaborator** | `admin` / `write` / `maintain` | Authorized to trigger reviews (`@njent review`), request automated code fixes (`@njent apply-fixes`), and approve/settle human-in-the-loop actions. |
| **External Contributor** | `read` / `none` | Submits PRs; receives bot review comments; cannot trigger bot execution or approve code commits. |
| **Njent Supervisor** | GitHub App Bot Identity | Reads PR diffs, executes specialist sub-agents, queries AST RAG, validates tests, and posts governed reviews. |

---

## 2. Trigger Commands & User Stories

### US-1: Full Multi-Perspective Code Review
* **Trigger:** Maintainer comments `@njent review` on a pull request.
* **Workflow:**
  1. `CollaboratorGuard` validates author permissions via GitHub API and checks hourly rate limits.
  2. `ContextPruner` strips noisy lockfiles and generated assets.
  3. `CodebaseRAGService` retrieves relevant AST classes, interfaces, and `ROADMAP.md` sections.
  4. `ParallelSubAgentRunner` executes `SecurityReviewer`, `ArchitectureReviewer`, and `QualityReviewer` concurrently.
  5. `RefinementLoopRunner` synthesizes findings via `LeadSynthesizer` and validates quality via `ReviewQualityEvaluator` (LLM-as-a-Judge).
  6. Posts verified inline comments and a summary checklist on the PR thread.

### US-2: Targeted Dimension Reviews
* **Triggers:**
  * `@njent check-security`: Dispatches only `SecurityReviewerAgent` to audit secrets, injection risks, and auth boundaries.
  * `@njent check-architecture`: Dispatches only `ArchitectureReviewerAgent` to verify DI decorators (`@Agent`, `@Tool`, `@Param`), governance policies, and milestone alignment.
  * `@njent check-performance`: Dispatches only `QualityReviewerAgent` to check algorithmic bottlenecks and typing.

### US-3: Automated Code Fix & Self-Correction
* **Trigger:** Maintainer comments `@njent apply-fixes`.
* **Workflow:**
  1. `CodeFixerAgent` reads actionable issues identified in the latest review.
  2. Generates proposed file modifications.
  3. `CodeValidatorService` executes TypeScript compilation (`tsc --noEmit`) and relevant unit tests (`jest --findRelatedTests`).
  4. If tests fail, compiler errors are fed back into a self-correction loop (max 3 retries).
  5. Once passing, `RequireMaintainerApprovalPolicy` suspends the turn, creates an immutable `ApprovalCheckpoint` in Redis, and posts an approval link.
  6. Upon maintainer settlement, Njent creates branch `njent/fix-pr-<number>`, commits changes, and opens a fix PR or updates the branch.

### US-4: False-Positive Feedback & Continuous Learning
* **Trigger:** Maintainer comments `@njent false-positive <explanation>` in reply to a bot comment.
* **Workflow:**
  1. `NjentExperienceService` extracts the flagged code pattern and maintainer explanation.
  2. Saves an episodic record to `ExperienceLearner` in `@nestjs-agentic/memory`.
  3. Future reviews retrieve these lessons to suppress duplicate false positives.

---

## 3. Comprehensive Functional Requirements Matrix

| ID | Category | Requirement Statement | Verified By |
|---|---|---|---|
| **FR-01** | **Ingress** | Validate GitHub Webhook HMAC-SHA256 signature on every request. | `WebhookController` |
| **FR-02** | **RBAC** | Reject non-collaborator triggers without executing LLM turns. | `CollaboratorGuard` |
| **FR-03** | **Rate Limiting** | Limit triggers to max 5 executions per PR per hour. | `RateLimiterGuard` |
| **FR-04** | **Diff Pruning** | Automatically exclude `.lock`, `.json`, `.min.js`, and binary files from LLM prompt context. | `ContextPruner` |
| **FR-05** | **AST Grounding** | Ground reviews using AST-aware chunks and parent-child class definitions. | `CodebaseRAGService` |
| **FR-06** | **Parallel Review** | Execute Security, Architecture, and Quality reviewers concurrently. | `ParallelSubAgentRunner` |
| **FR-07** | **Quality Gate** | Validate that 100% of line references exist in the diff before posting. | `ReviewQualityEvaluator` |
| **FR-08** | **Code Fix Tests** | Verify that all automated code fixes pass `tsc` and `jest` before asking for approval. | `CodeValidatorService` |
| **FR-09** | **Governance** | Require explicit human maintainer approval before creating commits or pushing branches. | `RequireMaintainerApprovalPolicy` |
| **FR-10** | **Idempotency** | Prevent duplicate GitHub comments or commits on webhook retries using SHA-256 keys. | `RedisIdempotencyStore` |
| **FR-11** | **Audit Trail** | Log every turn, deciding actor, token count, and policy decision to PostgreSQL. | `PostgresAuditSink` |
| **FR-12** | **Continuous Learning** | Store maintainer corrections in episodic memory to prevent repeating false positives. | `NjentExperienceService` |
