# @nestjs-agentic/core

## 1.6.0

### Minor Changes

- 22276c8: Add dual control (N-of-M approvals) for high-risk actions.

  - A `require_approval` policy decision can set `requiredApprovals`. The withheld tool then runs only after that many distinct approvers have called `ApprovalService.approve()`. Earlier calls return a `pending_approval` result with `signatures` and `requiredApprovals`. Every signature runs through the `ApprovalAuthorizer`, tenant isolation, and separation-of-duties checks and must carry `actor.userId`. A repeated signature from the same `userId` is refused rather than counted twice, and a single authorized `reject()` vetoes.
  - New optional `ApprovalStore.addSignature(id, signature)` appends a signature atomically and claims the approval on the one that meets the threshold, so exactly one caller settles it. Implemented by `InMemoryApprovalStore`, `PostgresApprovalStore`, and `RedisApprovalStore` (when the client exposes `eval`; the approval and its signatures share one key). Stores without it keep working for single-approver approvals, and a multi-approver decision on such a store is denied instead of downgraded.
  - **Behavior change:** when a policy returns `require_approval`, the remaining policies on the tool still run. A later `deny` now wins, and the approval takes the strictest terms across policies (most approvers, shortest `ttlSeconds`). Previously the first approval requirement stopped evaluation, so later policies, including deny rules, never ran for that call, because an approved call skips policies.
  - Each signature records the version of the approval it was given for (`approvalVersion`), and completion is refused if any signature was given for a different version. Every settlement path checks the signature count before the tool runs. Cancellation is honored before store writes, and an approval consumed by a cancelled call is put back.
  - `RedisApprovalStore` accepts an `evalFn` adapter (for node-redis v4 and similar). `claim()` uses an atomic script when the client has `eval` but no `getdel`. The signature script reads the record without decoding JSON.
  - New `approval_signed` audit event per counted signature, `requiredApprovals` on `approval_requested`, and `signatures` on `approval_settled`.
  - `runApprovalStoreContract` gains capability-gated groups for `addSignature`: threshold accumulation, duplicate rejection, and atomicity under concurrent signers. Its argument round-trip check no longer depends on JSON key order, which PostgreSQL `jsonb` does not preserve.
  - New exports: `ApprovalSignature`, `ApprovalSignatureResult`, `ApprovalSignedAuditEvent`, `ApprovalSignaturesUnsupportedError`, `requiredApprovalsOf`.

- 68218ea: New package: `@nestjs-agentic/jev`, Jev (TypeSafe System One) decisions for nestjs-agentic governance.

  - `JevActionGate(options)` creates an injectable tool policy that maps Jev's calibrated probability that a call is safe onto `allow` (at or above `allowAt`), `require_approval` (between the thresholds, with `requiredApprovals` as a number or a function of the probability for dual control), and `deny` (below `denyBelow`). Every decision reason, allow included, records the probability and thresholds for the audit trail. Unnamed gates get distinct names.
  - `JevOutputGate(options)` creates an output rail that withholds tool output, by default prompt injections, before the model sees it.
  - `describe` controls exactly what is sent to the TypeSafe API; an error it throws propagates instead of being treated as an outage. `onError` decides what happens when Jev is unreachable, slow (`timeoutMs`, enforced even for clients that ignore the abort signal), or answers malformed: human review by default for action gates, with `onErrorRequiredApprovals` approvers (required when `requiredApprovals` is a function), and deny for output gates. A circuit breaker, shared through `JevModule`, makes calls fail fast after repeated failures. A cancelled run throws `ExecutionCancelledError` rather than following `onError`.
  - `JevModule.forRoot()` / `forRootAsync()` share one client and defaults; each gate can also take its own `client`.
  - `jevFaithfulnessJudge` and `jevTaskJudge` plug into `@nestjs-agentic/evaluation`'s `FaithfulnessMetric` and `LLMAsAJudgeMetric`.
  - Works with `TypeSafeClient` from `@typesafe-ai/sdk` (optional peer dependency) or any client with a compatible `systemOne()`.

  Core: an `allow` policy result, before or after execution, may carry an optional `reason`, recorded on the audit trail (with `audit.includeAllowDecisions` for tool calls) and never shown to the model. When several policies require approval, a policy without its own `ttlSeconds` now counts with the module's `approvalTtlSeconds` when the shortest lifetime is chosen, so it is no longer outlived by another policy's longer explicit lifetime.

- f81f32e: Redact errors before they reach observers.

  Observers usually forward events to external telemetry, and provider SDK errors routinely carry request headers, API keys, and prompt content. `ObserverNotifier` now scrubs every error-carrying field before dispatch: `AgentErrorEvent.error`, `ModelRetryEvent.error`, `CircuitBreakerEvent.reason`, and the `error` text of failed tool results in `ToolResultEvent` and `AgentEndEvent`.

  - **Behavior change:** by default observers now receive a `RedactedError` instead of the original error. It keeps `name`, a credential-masked message capped at 500 characters, numeric `status`/`statusCode`, a short `code`, stack frames, and a redacted `cause` chain (3 links deep). Request config, headers, response bodies, and every other property are dropped. The error thrown to the caller of `run()` is unchanged.
  - Configure it with `observability.errorRedaction` on `AgenticModuleOptions`: pass `createErrorRedactor({ maxMessageLength, maxCauseDepth, patterns, mask })`, any `(error: unknown) => Error` (optionally with `redactText` for free text), or `'none'` to restore raw errors. Any other value is rejected. `ObserverNotifier` accepts the same setting as `errorRedaction`.
  - New exports: `ErrorRedactor`, `ObservabilityOptions`, `ErrorRedactorOptions`, `RedactedError`, `createErrorRedactor`, `defaultErrorRedactor`.

- cf18702: Add structured output: constrain an agent's final answer to a JSON Schema, with validation and bounded repair.

  - `outputSchema` (JSON Schema) on `AgentConfig` and `RunInput`, with optional `structuredOutput` options: `name`, `description`, `strict` (default `false`), `maxRepairAttempts` (default `2`), and a pluggable `validate` for Ajv, zod, or any validator.
  - The built-in runtime sends the schema as the new optional `ModelRequest.outputFormat`. Adapters that set `supportsStructuredOutput` forward it natively; for others the schema is described in that request's system prompt only. Existing adapters keep working unchanged.
  - The final answer is parsed (tolerating code fences and surrounding prose), validated, and repaired by re-prompting with the specific issues. The parsed value is returned as `AgentResult.structured`, and `runner.run<T>()` types it. A turn that never conforms fails with `StructuredOutputError`. Repair rounds count toward usage and budgets and stay out of session history.
  - Streaming emits `output_rejected` before each repair round and `structured` on `final_answer`.
  - A dependency-free `validateJsonSchema` covering the subset providers' structured-output modes use, plus `parseJsonAnswer`.
  - A turn that would run through a `RuntimeAdapter` with an `outputSchema` throws `StructuredOutputNotSupportedError` instead of returning unvalidated text.
  - A run that sets its own `outputSchema` does not inherit the agent's options (its `validate` in particular). Schemas with an invalid pattern or an unresolvable `$ref` throw `InvalidOutputSchemaError` before any model call. A refusal (`ModelResponse.refusal`) fails the turn without repair. A failed turn's conversation is still saved, and an approval whose resumed answer misses its schema is recorded as settled. The schema and repair state survive approval resume and checkpoint recovery, and an agent schema that broke after a run started does not block resuming it.
  - The validator also covers `patternProperties`, OpenAPI `nullable`, draft-07 tuples, code-point string lengths, patterns that need the non-Unicode regex mode, and deep recursive `$ref`s.
  - `OpenAiModelAdapter` sends `outputFormat` as `response_format: { type: 'json_schema' }` (non-object roots wrapped as `{ value }`, with root-relative `$ref`s kept pointing at the original root), sends schemas outside strict mode's subset non-strict instead of letting the request fail, reports refusals, and takes `structuredOutput: 'prompt'` for servers without `json_schema` support.

## 1.5.0

### Minor Changes

- 9ee3e4a: Add opt-in `durability: 'async'` and `observerTimeoutMs` to keep persistence and telemetry off a turn's critical path.

  - `durability: 'async'` (module option, overridable per run) queues in-flight checkpoint and history writes in order instead of awaiting each one, so the next model round no longer waits for a store round-trip after a tool call. The queue is drained before the turn completes and a failed write fails the turn there. The next turn for the same session in the same process waits for queued writes before reading history. Approval checkpoints and resumed turns stay synchronous. Default remains `sync`.
  - `observerTimeoutMs` bounds how long each observer hook can hold up a turn; observers keep running in the background. `ObserverNotifier` accepts the same bound as `timeoutMs`.
  - New `DeferredWriteQueue` utility.

### Patch Changes

- c679715: Support NestJS 12 and tighten what gets published.

  - Peer dependencies on `@nestjs/common` and `@nestjs/core` now accept `^12.0.0`, so installing into a NestJS 12 app no longer fails with `ERESOLVE`. Every package's test suite passes against NestJS 11.2 and 12.1, and CI now checks both. NestJS 12 is ESM only; with these CommonJS packages it needs Node 20.19+ or 22.12+.
  - Internal `*` ranges (`@nestjs-agentic/memory` in `rag`'s dependencies, and the `@nestjs-agentic/core` / `nestjs-agentic` peers of `memory`, `rag` and `openai`) are now `^1.4.0`, so a future major of a sibling package is never pulled in silently.
  - Compiled tests are written to `test-dist/` instead of `dist/test/`, so they are no longer published. `evaluation`, `mcp` and `orchestration` now declare `files` like the other packages, so they stop shipping `src/`, `test/` and `tsconfig.json` and exclude `test-dist/` even when packed outside the repo. `@nestjs-agentic/core` drops from 712 files (3.4 MB) to about 315 files (1.4 MB) unpacked.

## 1.4.0

### Minor Changes

- d0045d5: Add a provider-agnostic message reducer (context projector) that bounds tool-loop context growth. The executor keeps one append-only transcript per turn and re-sends it in full every round, so intermediate tool observations are billed again on every later request even inside the allowed loop. A reducer projects a bounded view for the model while leaving the canonical transcript, checkpoints, and approval resume unchanged.

  Configure through `AgenticModule.forRoot({ messageReducer })`, override per agent via `AgentConfig.messageReducer`, or per run via `RunInput.messageReducer`, resolved with the same precedence as limits. Unset is identity behavior, so existing runs are unchanged. The projection is applied consistently across `execute`, `stream`, `resume`, `resumeStream`, and checkpoint-resume, and runs before `onModelRequest`, so observers see the exact messages the adapter receives.

  - `AgentMessageReducer`, `AgentMessageReductionContext` — the reduction contract, invoked once per model round.
  - `BoundedToolHistoryReducer` — a deterministic reducer that keeps the last N complete tool groups verbatim and folds older ones into a compact run-state message, with no extra LLM summarization call. It always preserves the active pending-approval group.
  - `validateReduction`, `fingerprintTranscript` — validate a projection against the tool protocol (no orphan tool result, no split group, pending-approval group preserved, no input mutation), exported so custom reducers can self-check.
  - `MessageReducerContractError` — raised when a reducer returns a projection a provider would reject, rather than sending it.

  Closes #185.

- 482d6d6: Add `DistributedRateLimitPolicy`, a sliding-window rate limiter enforced across every instance sharing one Redis, closing the gap where N pods each admitted the configured limit independently. Evict, count, and admit happen in a single Lua `EVAL`, so concurrent callers cannot both take the last slot; a client without `eval` is rejected at construction rather than silently degraded to a racy read-then-write. Each window key carries a `PEXPIRE` matching the window, so idle callers' keys expire on their own.

  Denials now report back-off timing. `PolicyResult`'s `deny` variant gains an optional `retryAfterSeconds`, computed from the oldest call still inside the window rather than assuming a full window, surfaced in the reason text the model sees and recorded on the `tool_policy_decision` audit event. `RateLimitPolicy` reports it too.

  Adds `runRateLimiterContract` to `@nestjs-agentic/core`'s testing exports — a behavioral contract for any rate-limit policy, whose combined-limit groups create two limiters over one backend and assert they share a single allowance, including a race for the final slot. Closes #142.

- 56ca269: Add framework-level resilience for model calls: retry with exponential backoff and jitter, plus a circuit breaker that fails fast during a provider outage.

  Configure through `AgenticModule.forRoot({ resilience: { retry, circuitBreaker } })`. Both are opt-in and leave model calls unwrapped when unset, so existing behavior is unchanged.

  - `retryWithBackoff`, `isRetryableModelError`, `readRetryAfterMs` — retry primitives. Retries `429`/`5xx` and recognized transport faults, never `AgenticError`, aborts, or programming errors, and honors a provider's `Retry-After` hint over the computed delay. Backoff is interrupted by an `AbortSignal`.
  - `CircuitBreaker`, `CircuitOpenError` — closed/open/half-open breaker with a configurable failure threshold, cooldown, and success threshold.
  - `ResilientModelAdapter` — composes both around any `ModelAdapter`. The breaker sits outside the retry, so exhausted retries count as a single failure. Streams are retried only before the first chunk is emitted.
  - New observer hooks `onModelRetry` and `onCircuitStateChange` on `AgentObserver`.

## 1.3.0

### Minor Changes

- 0bd14be: Add approver authorization for pending approvals. `ApprovalService` now consults an optional `ApprovalAuthorizer` (registered through the new `APPROVAL_AUTHORIZER` token) before an approval is claimed, so a refused attempt leaves the approval pending instead of consuming it. Refusals raise `ApprovalNotAuthorizedError` and are recorded as a new `approval_settlement_denied` audit event.

  Three opt-in governance flags under `AgenticModuleOptions.approvals`:

  - `enforceSeparationOfDuties` — refuses a settlement when the approver is the identity that triggered the action. Tenant-scoped, so the same `userId` in two tenants is not treated as a conflict.
  - `enforceTenantIsolation` — refuses a settlement whose approver is not in the approval's tenant, so a leaked approval ID cannot be settled cross-tenant.
  - `requireAuthorizer` — refuses every settlement unless an authorizer is registered, letting a deployment fail closed.

  `PendingApproval` now carries `requestedBy`, stamped from the execution context at creation. All flags default to off, so settlement behavior is unchanged without configuration.

  Part of #139.

- eb84976: Add `AgenticModuleOptions.defaultPolicies`, a module-wide policy chain applied to every discovered tool that doesn't opt out via the new `@ExemptFromDefaultPolicies()` decorator — enabling deny-by-default governance instead of purely per-tool opt-in via `@UsePolicies`. Default policies evaluate before class-level and method-level `@UsePolicies`. Closes #135.
- 7f6ab34: Add `PiiRedactionPolicy`, a built-in Output Rail that detects and redacts email addresses, phone numbers (NANP and international), Luhn-validated credit card numbers, and US Social Security Numbers from tool output. Configurable per category, with custom patterns and sensitive-key masking (applied wholesale regardless of value type), mirroring `SecretRedactionPolicy`.

  Extracted the shared circular-reference-safe object traversal into `traverseAndRedact` (`packages/core/src/utils/redaction-traversal.ts`), now used by both policies, with an explicit supported boundary that fails closed outside it: strings/arrays/plain objects are rebuilt with matches redacted; `Map`/`Set` are rebuilt with keys and values redacted and **deny** if redaction would collapse two distinct entries into one; `Date`/`RegExp` are preserved as-is; class instances and platform built-ins (`URL`, `Error`, `Buffer`, typed arrays) are **inspected but never rewritten** — including symbol-keyed properties and `toJSON()` output — and **deny** when they hold sensitive data, since rebuilding them would lose internal state or trigger inherited setters; anything nested deeper than `maxDepth` is denied. Prototype-polluting keys (`__proto__`/`prototype`/`constructor`) are dropped and counted as a redaction. `PiiRedactionPolicy` validates `maxDepth` at construction and normalizes custom patterns once (stripping a sticky `y` flag that would otherwise skip matches not at the start of the input).

  Closes #138.

- ca8518f: Add `PromptInjectionSanitizer` (`@nestjs-agentic/core`), a utility that strips known chat-template/role-delimiter injection vectors (`<|im_start|>`, `[INST]`, `<system>`, `Human:`, etc.) and wraps untrusted content in explicit XML boundary tags, plus `PromptInjectionSanitizationPolicy`, a built-in Output Rail applying it to tool output automatically.

  `@nestjs-agentic/rag`'s `UShapedContextStrategy` and `ContextualCompressionStrategy` now wrap retrieved chunk content in a `<retrieved_chunk>` boundary and sanitize it before writing `compressedContext`, mitigating indirect prompt injection via poisoned documents. Closes #136.

- ad4fcaf: Add optional provenance/trust labels (`Provenance` / `ProvenanceSource`, `'model' | 'tool' | 'external' | 'user'`) to distinguish where content originated. `ToolExecutionResult` (all branches), the `{ role: 'tool' }` `ModelMessage`, and `DocumentChunk` now carry an optional `provenance` field. `LocalToolProvider` stamps successful tool results with `{ source: 'tool', origin: <toolName> }` and `AgentExecutor` stamps failed tool payloads and the resulting tool message the same way. `KnowledgeBase` retrieval always stamps chunks with `{ source: 'external', origin: <parentId> }` — retrieval is a trust boundary, so a store cannot launder external content under a trusted label. `ToolPolicy.evaluateOutput` receives the label as an optional fourth argument for trust-aware decisions. Fully additive — no behavior change for code that ignores it. Closes #137.
- 1a355a7: Add a tamper-evident audit trail. `HashChainAuditSink` wraps an audit destination and binds every event to its predecessor (`hash_n = H(hash_{n-1} || canonical(event_n))`), with `verifyAuditChain` detecting altered, deleted, reordered, and re-linked entries. Events are canonically serialized (sorted keys, ISO dates) so equal content always hashes equally; chaining is serialized so concurrent records still verify, and a chain can be resumed across restarts. `PostgresAuditSink` ships as a real, append-only `AuditSink` that also implements `ChainedAuditEntrySink`, persisting the chain columns and exposing `head()`/`readChain()` for resumption and verification.

  Part of #139.

## 1.2.0

## 1.1.0

### Patch Changes

- 5fc21d7: Fix `LocalToolProvider.invokeApprovedTool()` executing an approved tool and returning its raw result without ever running the post-execution Output Rail chain (`evaluateOutput`). An approved call is often the most sensitive one a tool makes, and its result now passes through the same `evaluateOutput` chain as a normal `allow`-decision call, so `SecretRedactionPolicy`, `CanaryDetectionPolicy`, and custom output rails can no longer be bypassed by requiring human approval.

  - `invokeApprovedTool` now accepts an optional `agentName` parameter, threaded through from `AgentRunner.settleApproval()` so approval-resume audit events (`tool_output_policy_decision`) carry the correct agent name.
  - Extracted the shared output-rail loop into a private `runOutputRails()` method used by both the normal policy-guarded tool closure and `invokeApprovedTool`, so the two paths cannot drift again.
  - Pre-execution policy evaluation on the approval-resume path is unchanged: policies before the one that required approval already ran once, and are not re-evaluated on resume, matching prior behavior.

- ff8982e: Fix `IdempotencyStore` lookups and saves in `LocalToolProvider` being keyed on the raw caller-supplied `idempotencyKey` alone, unlike `SessionStore` which already scopes by tenant. Two tenants supplying the same literal `idempotencyKey` (accidentally or deliberately) could read and cache each other's `ToolExecutionResult`, including its `data` payload — a cross-tenant data leak through a governance primitive.

  - `LocalToolProvider` now namespaces every idempotency key by tenant before it reaches the `IdempotencyStore`, on both the normal policy-guarded tool path and the approval-resume path (`invokeApprovedTool`).
  - Added a new exported `scopeKey(...parts)` utility that builds a collision-free composite key by JSON-encoding the segment tuple, rather than plain `:`-delimited concatenation — a `:` inside a tenant id or session id could otherwise let two different segment combinations collide onto the same store key. Also applied it to `AgentRunner.sessionKey()` and `RateLimitPolicy`, which had the same delimiter-collision exposure.
  - Added a tenant-isolation assertion group to `runIdempotencyStoreContract`, mirroring the existing tenant-isolation check in `runSessionStoreContract`: two records saved under distinct tenant-scoped keys must not collide.
  - Added regression tests proving two tenants using the same literal `idempotencyKey` (or session id) execute and cache independently.

- 816fa8f: Fix Output Rails (`ToolPolicy.evaluateOutput`) never running when a tool throws, so a thrown error's message (connection strings, upstream response bodies, API keys — exactly what `SecretRedactionPolicy`/`CanaryDetectionPolicy` are designed to catch) was reported to the model completely unsanitized.

  - Added an optional `ResolvedTool.sanitizeErrorMessage(rawMessage, args)` hook. `LocalToolProvider` implements it by running the tool's attached policies' `evaluateOutput` against the error message (wrapped as `{ error: message }`), applying `sanitize`/`deny` the same way it does for a successful result's `data`.
  - `AgentExecutor.toFailurePayload()` now calls this hook (when the tool provides one) before truncating the message to 500 characters. This is a fail-closed path: if the sanitizer itself throws (a broken or misconfigured policy), the raw message is replaced with a generic, non-sensitive placeholder rather than forwarded unsanitized — a broken policy must never be worse than no policy at all.
  - Only applies to `toolErrorHandling: 'report'` (the default). In `'throw'` mode the original exception propagates unmodified, since the run ends before anything would be reported to the model.
  - Providers without Output Rails (e.g. `McpToolProvider`) simply omit the hook; their error messages are unaffected.
  - Added regression tests proving (1) a tool that throws an error containing a Postgres connection string with a password has that string redacted before it reaches the model, and (2) when the sanitizer itself throws, a generic fail-closed message is reported instead of the raw error.

- ebc408b: Fix `RateLimitPolicy`'s shared history `Map` growing unboundedly. A key (`scopeKey(tenantId, userId, toolName)`) was created on first call and never removed, even once every timestamp in its window had expired — every distinct (tenant, user, tool) combination ever seen stayed in memory for the life of the process.

  - Added an opportunistic sweep, run at most once per `sweepIntervalMs` (default 5 minutes, configurable, `0` to sweep on every call), that evicts any history entry whose entire window has fully expired rather than just filtering its (now-empty) timestamp array.
  - The sweep runs lazily on the next `evaluate()` call after the interval elapses — not on a `setInterval` timer — so it never keeps the process alive and needs no explicit shutdown/cleanup.
  - Added regression tests proving a new combination adds exactly one history entry, and that a manually-expired entry is fully evicted (not just emptied) on the next sweep.

  Distributed (Redis-backed) rate limiting across multiple instances remains tracked separately as forward work in issue #142 — this only fixes the in-process memory growth, which was a real bug independent of the distributed-vs-local question.

## 0.7.0

### Minor Changes

- e58e49c: Comprehensive Milestone 0.8 ecosystem adapters, GraphRAG, Stanford cognitive memory, FrugalGPT model cascading, and position-debiased evaluation:

  - **@nestjs-agentic/mcp**: Native Model Context Protocol client transport, tool discovery, authorization, and secure tool invocation over Stdio and SSE.
  - **@nestjs-agentic/core**: FrugalGPT confidence-threshold model cascading (`ModelCascadeAdapter`, `ModelCascadeRouter`), prompt attention formatting (`UCurveContextFormatter`), and wall-clock execution duration metrics (`durationMs`).
  - **@nestjs-agentic/memory**: Stanford University Tri-Factor cognitive memory scoring (`StanfordMemoryScorer`), Procedural SOP playbooks (`ProceduralMemoryStore`), and cognitive reflection learning (`ReflectionEngine`, `ExperienceLearner`).
  - **@nestjs-agentic/rag**: AST-aware codebase semantic chunking (`AstCodebaseSplitter`), GraphRAG relational dependency traversal (`GraphRAGStrategy`, `GraphDependencyStrategy`), and U-Shaped attention distribution (`UShapedContextStrategy`).
  - **@nestjs-agentic/evaluation**: Pairwise position-swap debiased judge (`PairwiseDebiasedJudge`, `runPairwiseDebiasedJudge`), Trajectory step efficiency (`TrajectoryInspectorMetric`), and Tool execution precision (`ToolPrecisionMetric`).
  - **@nestjs-agentic/openai**: Full contract-tested OpenAI and ChatCompletions model adapter with streaming, reasoning token limits, and client injection.

- 73181d8: Add RedisSessionStore and SessionStore behavioral contract test suite.

  - adds `RedisSessionStore` implementing `SessionStore` with optional key prefixing and TTL expiration for session records
  - adds `runSessionStoreContract` behavioral test suite verifying serializability, mutation isolation, multi-tenant separation, and round-trip operations
  - updates `InMemorySessionStore` to store serialized snapshots rather than live references, matching persistent store behavior in development

- e0f6c3a: Add tool execution idempotency with IdempotencyStore, RedisIdempotencyStore, IdempotencyPolicy, and contract test suite.

  - adds `IdempotencyStore` and `RedisIdempotencyStore` to cache and deduplicate side-effecting tool executions
  - adds `IdempotencyPolicy` to validate and enforce presence of idempotency keys
  - updates `LocalToolProvider` to automatically return cached tool results when an idempotency key is provided
  - adds `runIdempotencyStoreContract` behavioral contract test suite

## 0.6.0

### Minor Changes

- fa2db68: Checkpoint suspended turns on the approval, so resuming no longer depends on session history.

  Resuming an approval previously read the transcript back from `SessionStore` and located the withheld tool message by `toolCallId`. That transcript is trimmed for replay and can be cleared independently of the approval, so a pending approval could become unresumable through no fault of its own — `ApprovalTranscriptMissingError`. Session retention effectively had to outlive every approval.

  The runtime now snapshots the suspension point onto the approval itself.

  - `PendingApproval` gains an optional `checkpoint`: a versioned `ApprovalCheckpoint` holding the conversation up to and including the withheld tool message, untrimmed and without system messages (instructions are re-derived from `AgentConfig` on resume)
  - `AgentRunner.settleApproval()` treats the checkpoint as authoritative and only falls back to session history for approvals created before checkpointing existed, or by a `RuntimeAdapter`
  - `AgentExecutor` reports the suspension through a new `onSuspend` callback rather than writing to a store itself, mirroring how `onTranscript` already works; `AgentRunner` owns persistence. Resumed turns that suspend again are checkpointed too.
  - the checkpoint is written before the suspended turn returns, and the `approvalId` only becomes observable when it does, so there is no window where an approval can be settled without a durable checkpoint
  - a checkpoint whose `version` this release does not support is refused with the new `ApprovalCheckpointVersionError` instead of being misread
  - `AgentRunner` accepts an optional `ApprovalStore` (injected via `APPROVAL_STORE`) to write checkpoints with

  Checkpoints are deliberately untrimmed, so an approval record is proportionally larger than the trimmed session transcript for the same turn.

  No breaking changes: `checkpoint` and `onSuspend` are optional, the new `AgentRunner` constructor parameter is optional and last, and approvals without a checkpoint keep resuming from session history exactly as before.

- c8c0392: Let human approvals expire instead of lingering forever.

  An approval that is never resolved previously stayed valid indefinitely, so a decision could eventually be applied against stale context (an order, price, or balance that has since changed). Approvals can now carry a lifetime.

  - `PendingApproval` gains an optional `expiresAt`. Resolving an approval after it throws the new `ApprovalExpiredError` rather than executing the decision, and the expired approval is consumed (the claim removes it) so it is not left behind for a retry.
  - the TTL comes from the `require_approval` policy result's new optional `ttlSeconds`, or failing that the module-level `approvalTtlSeconds` on `AgenticModule.forRoot()`; when neither is set the approval never expires, matching prior behavior
  - `RedisApprovalStore` derives the key's Redis TTL from `expiresAt` plus a configurable `expiryGraceSeconds` window (default 300s), so abandoned approvals are garbage-collected while a just-expired one can still be claimed to report the precise error. Approvals without `expiresAt` still fall back to the store's `ttlSeconds` option.

  No breaking changes: `expiresAt`, `ttlSeconds`, and `approvalTtlSeconds` are all optional and default to the previous never-expire behavior.

- 198325b: Publish a behavioral contract-test suite for `ApprovalStore`, and hold both built-in stores to it.

  `RedisApprovalStore` is the durable store applications are told to use in production, but it had no tests at all — including the `GETDEL` claim path and the TTL derivation that the exactly-once and expiry guarantees depend on. There was also no way for a third-party store to prove it behaves like the runtime expects.

  - adds `runApprovalStoreContract()`, exported from the package alongside `runModelAdapterContract()`, covering round-trip fidelity, `Date` revival, checkpoint persistence, returned-record isolation, `save()` as update, `delete()`, single-use `claim()`, and `claim()` atomicity under concurrent callers
  - `supportsAtomicClaim: false` skips the concurrency assertions for a store that cannot claim atomically — such as `RedisApprovalStore` behind a client without `GETDEL` — so the gap is counted as skipped rather than silently passing
  - both built-in stores and the `GETDEL` fallback path now run against the suite, plus `RedisApprovalStore`-specific coverage for key prefixing, TTL derived from `expiresAt` and the grace floor, `ttlSeconds` precedence, command selection, and the stored JSON payload shape

  The contract surfaced a real divergence between the two stores: `InMemoryApprovalStore` handed out live object references, so a caller mutating a record it read would silently corrupt stored state, and `createdAt` was whatever object was passed in rather than a revived `Date`. It now keeps serialized snapshots, matching what a persistent store must do. Code that works against the development store therefore behaves the same behind Redis, instead of failing only in production.

  No breaking changes to the `ApprovalStore` interface. Applications that read an approval, mutate the returned object, and expect the store to observe that mutation were relying on unintended behavior and must now `save()` explicitly.

- c0ea462: Make multi-turn conversation work.

  `AgentRunner` never loaded or saved conversation state, so every `run()` started from scratch and an agent could not remember the previous message. The built-in runtime now replays and persists history per session.

  - history is stored through `SessionStore`, keyed by `tenantId:sessionId` so two tenants cannot share a transcript
  - retention keeps the most recent messages, and trimming never leaves a tool result without the assistant message that requested it
  - system messages are not stored, since agent instructions are reapplied each turn
  - history is written when a turn ends or suspends for approval, never on failure
  - a failing history read does not fail the turn
  - `RunInput.history: false` runs a single turn statelessly, and `session.enabled: false` disables the feature
  - `forRoot()` accepts `sessionStore` and `session` options
  - `AgentExecutionInput` gains `onTranscript`, the hook the runner uses to persist a completed turn

  Also fixes `MockModelAdapter`, which selected its scripted round by counting every assistant message. Replayed history shifted the script, so rounds are now counted from the latest user message.

  History applies to the built-in runtime. Applications that delegate turns to a `RuntimeAdapter` continue to own their own state.

- 7d29d5b: Settle human approvals exactly once, even under concurrent calls or restart-triggered retries.

  Previously `ApprovalService.approve()`/`reject()` read the pending approval, ran its withheld tool, and only then deleted the record. Two concurrent calls for the same approval — or a retry after a restart — could both observe the record and run the side effect twice, which is unsafe for the sensitive operations approvals typically guard (refunds, payments, outbound messages).

  Settlement is now claim-first: the approval is removed atomically before its tool runs, so a given approval resolves at most once.

  - adds `ApprovalStore.claim(id)`, an atomic remove-and-return primitive; `approve()`/`reject()` call it before executing, and callers that lose the race throw `ApprovalNotFoundError`
  - `InMemoryApprovalStore.claim()` is atomic within a process; `RedisApprovalStore.claim()` uses Redis `GETDEL` for cross-instance atomicity when the client exposes it, falling back to a non-atomic get+del otherwise
  - extends the optional `GenericRedisClient` contract with `getdel?(key)`

  Because the claim happens before execution, a tool that fails after being claimed is not retried; end-to-end exactly-once for a side effect still depends on the tool being idempotent, tracked as follow-up idempotency-key work.

  Breaking change:

  - `ApprovalStore` now requires a `claim(id): Promise<PendingApproval | null>` method. Custom `ApprovalStore` implementations must add it; the built-in `InMemoryApprovalStore` and `RedisApprovalStore` already do.

- 89c6428: Record an auditable trail of governance decisions, including who approved.

  The framework gated sensitive tool calls but kept no record of it. Nothing captured that a call was denied, that an approval was requested, or who eventually approved it — so the governance boundary could not be reviewed after the fact. `AgentObserver` existed as an interface but was never called by the runtime.

  - adds `AuditSink`, a destination for `AuditEvent`s, registered through `auditSinks` on `AgenticModule.forRoot()` or the `AUDIT_SINKS` token. Auditing is opt-in: with no sink, nothing is recorded.
  - adds the `AuditTrail` service as the single choke point that applies filtering and redaction, so no call site can bypass them
  - records five events: `tool_policy_decision`, `approval_requested`, `approval_settled`, `approval_expired`, and `approval_settlement_failed`
  - `ApprovalService.approve()` / `.reject()` now accept an `actor` describing who is deciding, since identity is application-owned and the framework will not infer it
  - ships `InMemoryAuditSink` for tests and local inspection, and `ConsoleAuditSink` for log-pipeline deployments

  `approval_settlement_failed` covers the case worth alerting on: the tool failed _after_ the approval was claimed, so it cannot be retried and part of the side effect may already have applied.

  Three defaults are deliberate:

  - tool arguments are **withheld** unless `audit.includeArgs` is enabled, because they can carry secrets and personal data into a store that typically outlives application logs. `audit.sensitiveFields` masks named fields, including nested ones.
  - `allow` decisions are **not recorded** unless `audit.includeAllowDecisions` is enabled, since every framework-managed call produces one and that volume belongs to tracing.
  - a sink that throws is **isolated**. Failing an already-approved refund because a log store is unreachable is worse than losing the entry, so a sink that must not lose events should buffer durably itself.

  Model and tool execution traces and metrics are not included; those remain part of the observability milestone.

  No breaking changes. `actor`, `auditSinks`, and `audit` are optional, the new `AuditTrail` constructor parameters on `ApprovalService` and `LocalToolProvider` are optional and last, and applications that register no sink behave exactly as before.

- 0754d1f: Publish a reusable behavioral contract suite for model adapters.

  `runModelAdapterContract()` checks that a `ModelAdapter` implementation behaves the way the runtime expects, so third-party adapters can verify compliance instead of discovering differences at runtime.

  - exercises text rounds, tool-calling rounds, full conversations with prior tool results, usage mapping, request immutability, finish reasons, cancellation, and streaming
  - each scenario describes one provider round, matching the unit a `ModelAdapter` is responsible for
  - `CONTRACT_SYSTEM_MESSAGE`, `CONTRACT_USER_MESSAGE`, and `CONTRACT_TOOLS` are exported so a factory can key its stub transport on them
  - capabilities an adapter intentionally omits can be skipped, and skips are counted separately rather than passing silently
  - returns a structured result with failure descriptions rather than depending on a test framework

  `MockModelAdapter` now honors `request.signal` and rejects when it is already aborted, which the contract requires of every adapter.

- adc6ba9: Make human approval durable and resumable instead of a process-local closure.

  `PendingApproval` previously stored a JavaScript closure over the live tool instance and arguments, so it could not be persisted to an external store or resolved from a different process. Resolving it also never continued the model turn — it only returned the bare tool result, so the conversation had to be restarted separately to react to it.

  - `PendingApproval` is now a plain serializable record (`agentName`, `toolName`, `args`, `context`, `reason`, `createdAt`, `toolCallId`) with no closure, so any `ApprovalStore` can persist it across a restart or resolve it from a different instance
  - adds `RedisApprovalStore`, a production-intent, JSON-serializing `ApprovalStore` with optional TTL-based expiry
  - `ApprovalService.approve()` and `.reject()` now resume the suspended model turn when the approval originated from the built-in runtime: the tool outcome is spliced into the withheld tool message and the model reacts to it, exactly as it would to any other tool result
  - adds `AgentExecutor.resume()` and `.resumeStream()` to continue a turn from a persisted transcript and a resolved tool outcome
  - adds `AgentRunner.settleApproval()`, which resolves the pending record by re-resolving the agent and its tools through DI (using `agentName`/`toolName`) rather than a captured reference, and used internally by `ApprovalService`
  - `reject()` now accepts an optional `{ reason }`, and both `approve()`/`reject()` accept `{ signal }` for cancelling the resumed turn

  Breaking changes:

  - `ApprovalService.approve()` and `.reject()` now return `AgentResult | ToolExecutionResult` instead of `ToolExecutionResult | void`. The result is the full `AgentResult` when resuming a built-in-runtime turn (has a `toolCallId`), or the bare `ToolExecutionResult` for approvals created by an agent driven entirely by a `RuntimeAdapter` (no `toolCallId`), matching prior behavior for that path.
  - `PendingApproval.execute` (the closure) is removed. `ApprovalStore` implementations and any code constructing `PendingApproval` directly (for example in tests) must switch to the new serializable shape.
  - `approve()`/`reject()` now throw `ApprovalNotFoundError` instead of a plain `Error` for an unknown or already-resolved ID.
  - Resuming a turn requires the session's conversation history to still be present in `SessionStore`. If it was cleared or trimmed past the suspension point, resuming throws `ApprovalTranscriptMissingError`.

- 6eabac1: Recover from tool exceptions instead of ending the agent turn.

  A tool that threw previously rejected the whole run, so any database error or missing record ended the conversation. The runtime now reports the failure to the model as a tool message and continues, matching how invalid tool arguments are already handled.

  - adds `ToolErrorHandling` with `report` as the default and `throw` to opt back into fatal behavior, resolved per run, per agent, then per module
  - records the failure on `AgentResult.toolCalls` as `{ success: false, status: 'error', error }`
  - adds a `tool_error` stream event so a stream never leaves a `tool_start` without a terminal event
  - forwards only the error message, truncated to 500 characters, and never a stack trace
  - keeps framework errors fatal, and adds `PolicyNotRegisteredError` so an unregistered policy is reported to the caller rather than described to the model
  - reports cancellation observed during a tool invocation as `ExecutionCancelledError`

  `AgentStreamEvent` gains the `tool_error` variant. Consumers that exhaustively switch on the union without a default branch need to handle it.

## 0.5.0

### Minor Changes

- 526c0e1: Add the built-in agent runtime: a provider-neutral `ModelAdapter` contract and an `AgentExecutor` that drives the governed model-to-tool loop.

  - `ModelAdapter`, `ModelRequest`, `ModelResponse`, `ModelMessage`, `ModelToolCall`, and `ModelUsage` describe one model round without provider SDK types.
  - `AgentExecutor` iterates model rounds, executes tools through the existing `ResolvedTool` governance boundary, feeds results back to the model, and suspends the turn when a policy requires approval.
  - Tool arguments are validated against declared parameters before an application method runs. Undeclared keys are dropped and incomplete calls are reported to the model instead of invoking the tool.
  - `ExecutionLimits` plus `AbortSignal` support bound every turn by iterations, tool calls, tokens, and wall-clock time.
  - Streaming emits model tokens together with ordered tool lifecycle events.
  - `MockModelAdapter` scripts multi-round tool-calling scenarios for deterministic tests.
  - New error types: `AgenticError`, `ToolValidationError`, `ExecutionLimitExceededError`, `ExecutionCancelledError`, and `RuntimeNotConfiguredError`.

  `AgentRunner` uses the built-in runtime when a `ModelAdapter` is registered, and otherwise keeps delegating whole turns to a `RuntimeAdapter`, so existing applications continue to work unchanged.
