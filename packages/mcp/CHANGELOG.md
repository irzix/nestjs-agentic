# @nestjs-agentic/mcp

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
