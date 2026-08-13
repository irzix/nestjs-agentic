---
'@nestjs-agentic/core': minor
---

Make human approval durable and resumable instead of a process-local closure.

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
