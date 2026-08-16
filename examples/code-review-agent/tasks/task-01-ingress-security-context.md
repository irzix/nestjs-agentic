# Task 01: Ingress, Security Guards & Context Ingestion Layer

> **Implementation specification for GitHub Webhook Ingress, HMAC Verification, Collaborator RBAC, and Context Pruning.**

---

## 🎯 Objective
Implement the fast HTTP ingress gate for GitHub webhooks, enforce cryptographic signature verification and collaborator RBAC checks, prune noisy diff assets, and assemble the prompt context using the Stanford U-Shaped attention curve.

---

## 📁 Target Files to Create
* `src/webhooks/webhook.controller.ts`
* `src/guards/github-signature.guard.ts`
* `src/guards/collaborator.guard.ts`
* `src/guards/rate-limiter.guard.ts`
* `src/ingestion/context-pruner.ts`
* `src/context/u-curve-prompt-assembler.ts`
* `src/context/prompt-injection-sanitizer.ts`

---

## 📋 Detailed Technical Requirements

### 1. Webhook Controller (`src/webhooks/webhook.controller.ts`)
* Handle `POST /webhooks/github`.
* Acknowledge GitHub with `202 Accepted` within `< 200ms` after signature verification.
* Extract webhook payload: PR number, repository full name, author, comment body, and action trigger (`@njent review`, `@njent apply-fixes`).
* Dispatch background processing job to `PrReviewOrchestrator`.

### 2. Security Guards (`src/guards/`)
* **`github-signature.guard.ts`:** Verify `X-Hub-Signature-256` HMAC using `process.env.GITHUB_WEBHOOK_SECRET`. Reject mismatches with `401 Unauthorized`.
* **`collaborator.guard.ts`:** Verify that the triggering user possesses `admin`, `write`, or `maintain` repository permissions. Drop unprivileged triggers immediately.
* **`rate-limiter.guard.ts`:** Enforce sliding-window rate limits (max 5 bot reviews per PR per hour).

### 3. Context Pruning & U-Shape Assembly
* **`context-pruner.ts`:** Strip `.lock`, `.json`, `.min.js`, `.map`, and image diffs. Truncate files exceeding 350 lines with clear truncation notice.
* **`prompt-injection-sanitizer.ts`:** Wrap untrusted diffs and comments in `<untrusted_user_content>` and sanitize system delimiter tags (`[INST]`, `<|im_start|>`).
* **`u-curve-prompt-assembler.ts`:** Structure prompt tokens with high-primacy system rules at the top, reference context in the middle, and target PR diffs at the bottom.

---

## ✅ Acceptance Criteria & Testing
1. Webhook endpoint returns `401 Unauthorized` when HMAC signature is invalid.
2. Webhook endpoint returns `403 Forbidden` when non-collaborator attempts to trigger the bot.
3. Lockfiles (`package-lock.json`, `pnpm-lock.yaml`) are 100% excluded from the generated prompt context.
4. Unit tests pass: `npm run test:unit -- src/guards src/ingestion`
