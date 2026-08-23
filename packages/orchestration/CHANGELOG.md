# @nestjs-agentic/orchestration

## 1.0.1

### Patch Changes

- ff8982e: Fix the same delimiter-collision class of bug (see the `@nestjs-agentic/core` idempotency-scoping fix) in `RefinementLoopRunner`'s checkpoint/lock keys, `SopRunner`'s checkpoint key, and `SubAgentDelegator`'s sub-agent session id — all previously built via plain `:`-delimited string concatenation of tenant id, session id, and/or agent name, any of which could contain `:` and collide two different scopes onto the same key.

  All four now use `@nestjs-agentic/core`'s `scopeKey(...)` utility.

- Updated dependencies [5fc21d7]
- Updated dependencies [ff8982e]
- Updated dependencies [816fa8f]
- Updated dependencies [ebc408b]
  - @nestjs-agentic/core@1.0.1

## 0.7.0

### Minor Changes

- e58e49c: Comprehensive Milestone 0.8 ecosystem adapters, GraphRAG, Stanford cognitive memory, FrugalGPT model cascading, and position-debiased evaluation:

  - **@nestjs-agentic/mcp**: Native Model Context Protocol client transport, tool discovery, authorization, and secure tool invocation over Stdio and SSE.
  - **@nestjs-agentic/core**: FrugalGPT confidence-threshold model cascading (`ModelCascadeAdapter`, `ModelCascadeRouter`), prompt attention formatting (`UCurveContextFormatter`), and wall-clock execution duration metrics (`durationMs`).
  - **@nestjs-agentic/memory**: Stanford University Tri-Factor cognitive memory scoring (`StanfordMemoryScorer`), Procedural SOP playbooks (`ProceduralMemoryStore`), and cognitive reflection learning (`ReflectionEngine`, `ExperienceLearner`).
  - **@nestjs-agentic/rag**: AST-aware codebase semantic chunking (`AstCodebaseSplitter`), GraphRAG relational dependency traversal (`GraphRAGStrategy`, `GraphDependencyStrategy`), and U-Shaped attention distribution (`UShapedContextStrategy`).
  - **@nestjs-agentic/evaluation**: Pairwise position-swap debiased judge (`PairwiseDebiasedJudge`, `runPairwiseDebiasedJudge`), Trajectory step efficiency (`TrajectoryInspectorMetric`), and Tool execution precision (`ToolPrecisionMetric`).
  - **@nestjs-agentic/openai**: Full contract-tested OpenAI and ChatCompletions model adapter with streaming, reasoning token limits, and client injection.

- 92dabec: Add bounded concurrency (`maxConcurrency`) and `AbortSignal` cancellation support to `ParallelSubAgentRunner`, `SubAgentDelegator`, and `RefinementLoopRunner`.

  - adds `maxConcurrency` option to `ParallelRunnerOptions` to throttle concurrent sub-agent executions without unbounded fan-out
  - adds `signal` support across `SubAgentTask`, `ParallelRunnerOptions`, and `RefinementLoopOptions` for graceful cancellation
  - adds unit test coverage for bounded concurrency limits and early abort handling

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

### Patch Changes

- Updated dependencies [526c0e1]
  - @nestjs-agentic/core@0.5.0
