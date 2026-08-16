---
'@nestjs-agentic/orchestration': minor
---

Add bounded concurrency (`maxConcurrency`) and `AbortSignal` cancellation support to `ParallelSubAgentRunner`, `SubAgentDelegator`, and `RefinementLoopRunner`.

- adds `maxConcurrency` option to `ParallelRunnerOptions` to throttle concurrent sub-agent executions without unbounded fan-out
- adds `signal` support across `SubAgentTask`, `ParallelRunnerOptions`, and `RefinementLoopOptions` for graceful cancellation
- adds unit test coverage for bounded concurrency limits and early abort handling
