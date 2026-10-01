---
"@nestjs-agentic/jev": minor
---

New package: `@nestjs-agentic/jev`, Jev (TypeSafe System One) decisions for nestjs-agentic governance.

- `JevActionGate(options)` creates an injectable tool policy that maps Jev's calibrated probability that a call is safe onto `allow` (at or above `allowAt`), `require_approval` (between the thresholds, with `requiredApprovals` as a number or a function of the probability for dual control), and `deny` (below `denyBelow`). Decision reasons record the probability and thresholds for the audit trail.
- `JevOutputGate(options)` creates an output rail that withholds tool output, by default prompt injections, before the model sees it.
- `describe` controls exactly what is sent to the TypeSafe API. `onError` decides what happens when Jev is unreachable, slow (`timeoutMs`), or answers malformed: human review by default for action gates, deny for output gates. The run's cancellation signal reaches the Jev call.
- `JevModule.forRoot()` / `forRootAsync()` share one client and defaults; each gate can also take its own `client`.
- `jevFaithfulnessJudge` and `jevTaskJudge` plug into `@nestjs-agentic/evaluation`'s `FaithfulnessMetric` and `LLMAsAJudgeMetric`.
- Works with `TypeSafeClient` from `@typesafe-ai/sdk` (optional peer dependency) or any client with a compatible `systemOne()`.
