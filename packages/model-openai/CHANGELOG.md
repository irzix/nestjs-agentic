# @nestjs-agentic/openai

## 1.6.0

### Minor Changes

- cf18702: Add structured output: constrain an agent's final answer to a JSON Schema, with validation and bounded repair.

  - `outputSchema` (JSON Schema) on `AgentConfig` and `RunInput`, with optional `structuredOutput` options: `name`, `description`, `strict` (default `false`), `maxRepairAttempts` (default `2`), and a pluggable `validate` for Ajv, zod, or any validator.
  - The built-in runtime sends the schema as the new optional `ModelRequest.outputFormat`. Adapters that set `supportsStructuredOutput` forward it natively; for others the schema is described in that request's system prompt only. Existing adapters keep working unchanged.
  - The final answer is parsed (tolerating code fences and surrounding prose), validated, and repaired by re-prompting with the specific issues. The parsed value is returned as `AgentResult.structured`, and `runner.run<T>()` types it. A turn that never conforms fails with `StructuredOutputError`. Repair rounds count toward usage and budgets and stay out of session history.
  - Streaming emits `output_rejected` before each repair round and `structured` on `final_answer`.
  - A dependency-free `validateJsonSchema` covering the subset providers' structured-output modes use, plus `parseJsonAnswer`.
  - A turn that would run through a `RuntimeAdapter` with an `outputSchema` throws `StructuredOutputNotSupportedError` instead of returning unvalidated text.
  - A run that sets its own `outputSchema` does not inherit the agent's options (its `validate` in particular). Schemas with an invalid pattern or an unresolvable `$ref` throw `InvalidOutputSchemaError` before any model call. A refusal (`ModelResponse.refusal`) fails the turn without repair. A failed turn's conversation is still saved, and an approval whose resumed answer misses its schema is recorded as settled. The schema and repair state survive approval resume and checkpoint recovery, and an agent schema that broke after a run started does not block resuming it.
  - The validator also covers `patternProperties`, OpenAPI `nullable`, draft-07 tuples, code-point string lengths, patterns that need the non-Unicode regex mode, and deep recursive `$ref`s.
  - `OpenAiModelAdapter` sends `outputFormat` as `response_format: { type: 'json_schema' }` (non-object roots wrapped as `{ value }`, with root-relative `$ref`s kept pointing at the original root), sends schemas outside strict mode's subset non-strict instead of letting the request fail, reports refusals, and takes `structuredOutput: 'prompt'` for servers without `json_schema` support.

## 1.5.0

### Patch Changes

- c679715: Support NestJS 12 and tighten what gets published.

  - Peer dependencies on `@nestjs/common` and `@nestjs/core` now accept `^12.0.0`, so installing into a NestJS 12 app no longer fails with `ERESOLVE`. Every package's test suite passes against NestJS 11.2 and 12.1, and CI now checks both. NestJS 12 is ESM only; with these CommonJS packages it needs Node 20.19+ or 22.12+.
  - Internal `*` ranges (`@nestjs-agentic/memory` in `rag`'s dependencies, and the `@nestjs-agentic/core` / `nestjs-agentic` peers of `memory`, `rag` and `openai`) are now `^1.4.0`, so a future major of a sibling package is never pulled in silently.
  - Compiled tests are written to `test-dist/` instead of `dist/test/`, so they are no longer published. `evaluation`, `mcp` and `orchestration` now declare `files` like the other packages, so they stop shipping `src/`, `test/` and `tsconfig.json` and exclude `test-dist/` even when packed outside the repo. `@nestjs-agentic/core` drops from 712 files (3.4 MB) to about 315 files (1.4 MB) unpacked.

## 1.4.0

## 1.3.0

## 1.2.0

## 1.1.0

## 0.7.0

### Minor Changes

- e58e49c: Comprehensive Milestone 0.8 ecosystem adapters, GraphRAG, Stanford cognitive memory, FrugalGPT model cascading, and position-debiased evaluation:

  - **@nestjs-agentic/mcp**: Native Model Context Protocol client transport, tool discovery, authorization, and secure tool invocation over Stdio and SSE.
  - **@nestjs-agentic/core**: FrugalGPT confidence-threshold model cascading (`ModelCascadeAdapter`, `ModelCascadeRouter`), prompt attention formatting (`UCurveContextFormatter`), and wall-clock execution duration metrics (`durationMs`).
  - **@nestjs-agentic/memory**: Stanford University Tri-Factor cognitive memory scoring (`StanfordMemoryScorer`), Procedural SOP playbooks (`ProceduralMemoryStore`), and cognitive reflection learning (`ReflectionEngine`, `ExperienceLearner`).
  - **@nestjs-agentic/rag**: AST-aware codebase semantic chunking (`AstCodebaseSplitter`), GraphRAG relational dependency traversal (`GraphRAGStrategy`, `GraphDependencyStrategy`), and U-Shaped attention distribution (`UShapedContextStrategy`).
  - **@nestjs-agentic/evaluation**: Pairwise position-swap debiased judge (`PairwiseDebiasedJudge`, `runPairwiseDebiasedJudge`), Trajectory step efficiency (`TrajectoryInspectorMetric`), and Tool execution precision (`ToolPrecisionMetric`).
  - **@nestjs-agentic/openai**: Full contract-tested OpenAI and ChatCompletions model adapter with streaming, reasoning token limits, and client injection.

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
