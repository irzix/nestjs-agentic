# @nestjs-agentic/memory

## 1.5.0

### Minor Changes

- 2a60a91: Fix tenant isolation in `ExperienceLearner`.

  **Behavior change:** a lesson recorded with a `tenantId` is now recalled only when the same `tenantId` is passed to `recallLessons` / `buildGuidancePrompt`. Code that recorded with a tenant and recalled without one was reading other tenants' lessons through the fallback cache; pass the tenant when recalling. The code-review example is updated to scope lessons per repository.

  - The in-process fallback cache was keyed by trigger only, so a lesson recorded for one tenant could be recalled for another whenever the memory store returned nothing. It is now keyed by tenant scope and trigger.
  - `AgentTrajectory` accepts an optional `tenantId`. `critiqueTrajectory` stores lessons under it, so one session's lessons reach the tenant's later sessions. Without it, lessons stay scoped to `sessionId` as before.
  - The fallback cache is bounded (`maxFallbackRecords`, default 1000, `0` disables it) and evicts the least recently written lessons first.
  - Raw tool error text is no longer copied into lessons, which are later injected into prompts as guidance. It stays in the critique, truncated to 500 characters.
  - `buildGuidancePrompt` renders each lesson as a single line without control characters, capped at 300 characters.

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
