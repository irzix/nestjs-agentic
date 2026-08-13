---
'@nestjs-agentic/core': minor
---

Publish a reusable behavioral contract suite for model adapters.

`runModelAdapterContract()` checks that a `ModelAdapter` implementation behaves the way the runtime expects, so third-party adapters can verify compliance instead of discovering differences at runtime.

- exercises text rounds, tool-calling rounds, full conversations with prior tool results, usage mapping, request immutability, finish reasons, cancellation, and streaming
- each scenario describes one provider round, matching the unit a `ModelAdapter` is responsible for
- `CONTRACT_SYSTEM_MESSAGE`, `CONTRACT_USER_MESSAGE`, and `CONTRACT_TOOLS` are exported so a factory can key its stub transport on them
- capabilities an adapter intentionally omits can be skipped, and skips are counted separately rather than passing silently
- returns a structured result with failure descriptions rather than depending on a test framework

`MockModelAdapter` now honors `request.signal` and rejects when it is already aborted, which the contract requires of every adapter.
