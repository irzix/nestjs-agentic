---
'@nestjs-agentic/core': minor
---

Checkpoint suspended turns on the approval, so resuming no longer depends on session history.

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
