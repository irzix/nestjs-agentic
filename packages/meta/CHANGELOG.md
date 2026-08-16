# nestjs-agentic

## 0.7.0

### Patch Changes

- Updated dependencies [73181d8]
- Updated dependencies [e0f6c3a]
  - @nestjs-agentic/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [fa2db68]
- Updated dependencies [c8c0392]
- Updated dependencies [198325b]
- Updated dependencies [c0ea462]
- Updated dependencies [7d29d5b]
- Updated dependencies [89c6428]
- Updated dependencies [0754d1f]
- Updated dependencies [adc6ba9]
- Updated dependencies [6eabac1]
  - @nestjs-agentic/core@0.6.0

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

### Patch Changes

- Updated dependencies [526c0e1]
  - @nestjs-agentic/core@0.5.0
