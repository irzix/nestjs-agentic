# @nestjs-agentic/jev

## 1.6.0

### Minor Changes

- 68218ea: New package: `@nestjs-agentic/jev`, Jev (TypeSafe System One) decisions for nestjs-agentic governance.

  - `JevActionGate(options)` creates an injectable tool policy that maps Jev's calibrated probability that a call is safe onto `allow` (at or above `allowAt`), `require_approval` (between the thresholds, with `requiredApprovals` as a number or a function of the probability for dual control), and `deny` (below `denyBelow`). Every decision reason, allow included, records the probability and thresholds for the audit trail. Unnamed gates get distinct names.
  - `JevOutputGate(options)` creates an output rail that withholds tool output, by default prompt injections, before the model sees it.
  - `describe` controls exactly what is sent to the TypeSafe API; an error it throws propagates instead of being treated as an outage. `onError` decides what happens when Jev is unreachable, slow (`timeoutMs`, enforced even for clients that ignore the abort signal), or answers malformed: human review by default for action gates, with `onErrorRequiredApprovals` approvers (required when `requiredApprovals` is a function), and deny for output gates. A circuit breaker, shared through `JevModule`, makes calls fail fast after repeated failures. A cancelled run throws `ExecutionCancelledError` rather than following `onError`.
  - `JevModule.forRoot()` / `forRootAsync()` share one client and defaults; each gate can also take its own `client`.
  - `jevFaithfulnessJudge` and `jevTaskJudge` plug into `@nestjs-agentic/evaluation`'s `FaithfulnessMetric` and `LLMAsAJudgeMetric`.
  - Works with `TypeSafeClient` from `@typesafe-ai/sdk` (optional peer dependency) or any client with a compatible `systemOne()`.

  Core: an `allow` policy result, before or after execution, may carry an optional `reason`, recorded on the audit trail (with `audit.includeAllowDecisions` for tool calls) and never shown to the model. When several policies require approval, a policy without its own `ttlSeconds` now counts with the module's `approvalTtlSeconds` when the shortest lifetime is chosen, so it is no longer outlived by another policy's longer explicit lifetime.
