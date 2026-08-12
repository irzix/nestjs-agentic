---
'@nestjs-agentic/core': minor
---

Recover from tool exceptions instead of ending the agent turn.

A tool that threw previously rejected the whole run, so any database error or missing record ended the conversation. The runtime now reports the failure to the model as a tool message and continues, matching how invalid tool arguments are already handled.

- adds `ToolErrorHandling` with `report` as the default and `throw` to opt back into fatal behavior, resolved per run, per agent, then per module
- records the failure on `AgentResult.toolCalls` as `{ success: false, status: 'error', error }`
- adds a `tool_error` stream event so a stream never leaves a `tool_start` without a terminal event
- forwards only the error message, truncated to 500 characters, and never a stack trace
- keeps framework errors fatal, and adds `PolicyNotRegisteredError` so an unregistered policy is reported to the caller rather than described to the model
- reports cancellation observed during a tool invocation as `ExecutionCancelledError`

`AgentStreamEvent` gains the `tool_error` variant. Consumers that exhaustively switch on the union without a default branch need to handle it.
