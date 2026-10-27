<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">@nestjs-agentic/core</h1>

<p align="center">
  <b>Available NestJS primitives and governance boundary for the NestJS-native runtime for governed AI agents</b>
</p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-v10%2B-E0234E?style=flat&logo=nestjs&logoColor=white" alt="NestJS Compatible" /></a>
  <a href="https://www.npmjs.com/package/@nestjs-agentic/core"><img src="https://img.shields.io/npm/v/@nestjs-agentic/core.svg?color=E0234E" alt="NPM Version" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@nestjs-agentic/core.svg?color=blue" alt="License" /></a>
</p>

---

## Overview

`@nestjs-agentic/core` provides the foundational building blocks for `nestjs-agentic`:

- **Decorator Suite**: `@Agent()`, `@ToolSet()`, `@Tool()`, `@Param()`, `@Context()`, `@UsePolicies()`
- **Policy Engine**: 3-state evaluation (`allow`, `deny`, `require_approval`)
- **Built-in Agent Runtime**: `AgentExecutor` runs the governed model-to-tool loop with argument validation, execution budgets, cancellation, and streaming, driven by a provider-neutral `ModelAdapter`
- **FrugalGPT Model Cascading**: Native cost optimization (*Chen et al., Stanford University, NeurIPS 2023*) cascading cheap/fast models to frontier reasoning models with confidence threshold gating ($\tau$) with workload-dependent cost and quality trade-offs
- **HITL Lifecycle (Experimental)**: `ApprovalService` and in-memory/custom `ApprovalStore` protect one process-local pending invocation; approval is not a durable workflow pause and does not resume the original model turn.
- **Session Management**: `SessionStore` (`InMemorySessionStore`, `RedisSessionStore`), `runSessionStoreContract`, and context pre-binding
- **Mock Runtime**: `MockRuntimeAdapter` and `MockModelAdapter` for LLM-free unit testing, including multi-round tool-calling scenarios

## Installation

```bash
npm install @nestjs-agentic/core
```

*(Note: We recommend installing the main meta-package `nestjs-agentic` instead).*

## Documentation & Usage

For full documentation and code examples, see the [nestjs-agentic GitHub Repository](https://github.com/irzix/nestjs-agentic#readme).

## License

MIT © [irzix](https://github.com/irzix)

### Experimental model cascading

Cascade thresholds use an application-supplied `extractorFn` or uncalibrated text
heuristics. They are not correctness probabilities. Tool-call syntax receives a
default heuristic score of `0`; provide an evaluator to accept a tool call before
the final fallback tier. `accept_last` still accepts the final tier by design.

`ModelCascadeAdapter.stream()` buffers until a tier is accepted, then emits that
exact answer and its cumulative usage. It does not regenerate or incrementally
stream unvalidated tokens. Use the model adapter directly when incremental token
latency matters more than evaluating complete candidates.
