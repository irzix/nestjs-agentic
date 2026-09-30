---
"@nestjs-agentic/core": minor
---

Add opt-in `durability: 'async'` and `observerTimeoutMs` to keep persistence and telemetry off a turn's critical path.

- `durability: 'async'` (module option, overridable per run) queues in-flight checkpoint and history writes in order instead of awaiting each one, so the next model round no longer waits for a store round-trip after a tool call. The queue is drained before the turn completes and a failed write fails the turn there. The next turn for the same session in the same process waits for queued writes before reading history. Approval checkpoints and resumed turns stay synchronous. Default remains `sync`.
- `observerTimeoutMs` bounds how long each observer hook can hold up a turn; observers keep running in the background. `ObserverNotifier` accepts the same bound as `timeoutMs`.
- New `DeferredWriteQueue` utility.
