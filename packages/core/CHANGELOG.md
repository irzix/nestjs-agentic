# @nestjs-agentic/core

## 0.7.0

### Minor Changes

- 73181d8: Add RedisSessionStore and SessionStore behavioral contract test suite.

  - adds `RedisSessionStore` implementing `SessionStore` with optional key prefixing and TTL expiration for session records
  - adds `runSessionStoreContract` behavioral test suite verifying serializability, mutation isolation, multi-tenant separation, and round-trip operations
  - updates `InMemorySessionStore` to store serialized snapshots rather than live references, matching persistent store behavior in development

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
