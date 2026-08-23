# @nestjs-agentic/openai

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
