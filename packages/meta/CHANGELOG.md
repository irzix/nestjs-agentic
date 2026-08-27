# nestjs-agentic

## 1.4.0

### Patch Changes

- Updated dependencies [482d6d6]
- Updated dependencies [56ca269]
  - @nestjs-agentic/core@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies [0bd14be]
- Updated dependencies [eb84976]
- Updated dependencies [7f6ab34]
- Updated dependencies [ca8518f]
- Updated dependencies [ad4fcaf]
- Updated dependencies [1a355a7]
  - @nestjs-agentic/core@1.3.0

## 1.2.0

### Patch Changes

- @nestjs-agentic/core@1.2.0

## 1.1.0

### Patch Changes

- Updated dependencies [5fc21d7]
- Updated dependencies [ff8982e]
- Updated dependencies [816fa8f]
- Updated dependencies [ebc408b]
  - @nestjs-agentic/core@1.1.0

## 0.7.0

### Minor Changes

- e58e49c: Comprehensive Milestone 0.8 ecosystem adapters, GraphRAG, Stanford cognitive memory, FrugalGPT model cascading, and position-debiased evaluation:

  - **@nestjs-agentic/mcp**: Native Model Context Protocol client transport, tool discovery, authorization, and secure tool invocation over Stdio and SSE.
  - **@nestjs-agentic/core**: FrugalGPT confidence-threshold model cascading (`ModelCascadeAdapter`, `ModelCascadeRouter`), prompt attention formatting (`UCurveContextFormatter`), and wall-clock execution duration metrics (`durationMs`).
  - **@nestjs-agentic/memory**: Stanford University Tri-Factor cognitive memory scoring (`StanfordMemoryScorer`), Procedural SOP playbooks (`ProceduralMemoryStore`), and cognitive reflection learning (`ReflectionEngine`, `ExperienceLearner`).
  - **@nestjs-agentic/rag**: AST-aware codebase semantic chunking (`AstCodebaseSplitter`), GraphRAG relational dependency traversal (`GraphRAGStrategy`, `GraphDependencyStrategy`), and U-Shaped attention distribution (`UShapedContextStrategy`).
  - **@nestjs-agentic/evaluation**: Pairwise position-swap debiased judge (`PairwiseDebiasedJudge`, `runPairwiseDebiasedJudge`), Trajectory step efficiency (`TrajectoryInspectorMetric`), and Tool execution precision (`ToolPrecisionMetric`).
  - **@nestjs-agentic/openai**: Full contract-tested OpenAI and ChatCompletions model adapter with streaming, reasoning token limits, and client injection.

### Patch Changes

- Updated dependencies [e58e49c]
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
