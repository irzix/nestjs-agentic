# @nestjs-agentic/openai

## 0.6.0

## 0.5.0

### Minor Changes

- 5872b46: Add `@nestjs-agentic/openai`, an OpenAI `ModelAdapter` built on the official `openai` SDK.

  - Drives the built-in `AgentExecutor` loop, so tool execution, policy evaluation, argument validation, budgets, and streaming remain framework concerns.
  - Translates declared `@Param` metadata into JSON Schema function tools, and parses tool-call arguments back into objects. Malformed argument JSON degrades to an empty object so executor validation reports it to the model instead of failing the turn.
  - Streams content deltas as tokens and reassembles fragmented tool-call deltas before emitting the final round.
  - Wraps SDK failures in `OpenAiModelError` with `status`, `code`, and `cause`, reporting cancellation as `aborted` and SDK timeouts as `timeout`. API keys are never included in error messages.
  - Supports Chat Completions compatible endpoints through `baseUrl`, Azure through an injected `AzureOpenAI` client, and reasoning models through `maxCompletionTokens`.
  - `getClient()` exposes the SDK client for provider features outside the adapter contract.

  `openai` is declared as a peer dependency so applications control the SDK version.
