# @nestjs-agentic/core

## 0.6.0

### Minor Changes

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
