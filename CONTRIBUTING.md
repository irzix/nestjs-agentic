# Contributing to nestjs-agentic

Thanks for your interest in contributing. This document covers the practical stuff — how to set up the project, how we work, and what to expect when you submit a PR.

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/irzix/nestjs-agentic.git
cd nestjs-agentic
npm install
npm run build
```

The project uses npm workspaces. `npm install` at the root handles everything.

### Project structure

```text
packages/
  core/                 → NestJS primitives and governance boundary
  model-openai/         → OpenAI ModelAdapter (@nestjs-agentic/openai)
  runtime-adk/          → Synthetic runtime prototype (@nestjs-agentic/adk)
  runtime-langgraph/    → Limited LangChain/LangGraph compatibility adapter
  memory/               → Experimental opt-in memory primitives
  rag/                  → Experimental opt-in retrieval primitives
  orchestration/        → Experimental delegation and refinement APIs
  evaluation/           → Experimental metrics and benchmarks
examples/
  customer-support/     → ADK prototype evaluation example
  financial-governance/ → Governance and mock-runtime example
  langgraph-workflow/   → LangGraph adapter fallback evaluation
apps/
  landing/              → Project website
```

### Running tests

```bash
# All packages
npm test

# Single package without changing directories
npm test --workspace=@nestjs-agentic/core
```

### Building

```bash
npm run build
```

### Running an example

The customer-support HTTP example registers the synthetic ADK-named runtime prototype. It does not call Google ADK or Gemini and invokes tools with empty arguments, so use it only for evaluation:

```bash
npm run start:dev --workspace=example-customer-support
```

For deterministic governance behavior, prefer the test suites that configure `MockRuntimeAdapter`.

## How to contribute

### Reporting bugs

Open an issue. Include:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Your environment (Node version, NestJS version, runtime adapter)

A minimal reproduction repo or failing test is extremely helpful.

### Suggesting features

Open an issue with the `feature` label. Describe:

1. The problem you're trying to solve
2. How you'd expect the API to look
3. Any alternatives you've considered

We prefer to discuss design before implementation, especially for anything that touches public API.

### Submitting a pull request

1. Fork the repo and create a branch from `main`
2. If you're adding functionality, add tests
3. Make sure the test suite passes (`npm test`)
4. Make sure the build succeeds (`npm run build`)
5. Write a clear PR description

#### PR guidelines

- **One concern per PR.** A bug fix and a feature should be separate PRs.
- **Follow existing patterns.** Look at how existing decorators, interfaces, and services are structured. Match that style.
- **Test behavior, not implementation.** Test what a decorator or service does, not how it does it internally.
- **Keep public API changes small.** If your PR changes a public interface, explain why in the description.

## Code style

- TypeScript strict mode
- No `any` — use `unknown` with narrowing or explicit types
- Interfaces over abstract classes (composition over inheritance)
- NestJS conventions: decorators for declaration, interfaces for contracts, DI for wiring

We don't have an automated formatter enforced yet. Just follow what you see in the existing code.

## Architecture decisions

The [Architecture Guide](docs/ARCHITECTURE.md) explains the design decisions behind the library. If you're working on core abstractions such as `RuntimeAdapter`, `ResolvedTool`, policies, approvals, or state stores, read it first.

Key principles:

- **Core knows nothing about specific runtimes.** No ADK, LangGraph, or provider SDK imports belong in `packages/core`.
- **Policies live inside resolved tool closures.** Runtime adapters invoke `ResolvedTool.execute()` and do not bypass governance.
- **Explicit registration only.** Agents, tool sets, and policies are registered through `forFeature()`.
- **Policy outcomes are return values.** A denial returns `{ success: false, status: 'denied', reason }`; it is not thrown as an exception.
- **Claims follow implementation and tests.** Mark incomplete provider, durability, and observability behavior as experimental.

## Versioning

We follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.0.x): Bug fixes, documentation updates
- **Minor** (0.x.0): New features, new decorators, new interfaces (backward compatible)
- **Major** (x.0.0): Breaking changes to public API

During 0.x development, minor versions may include breaking changes. We'll document these clearly in the changelog.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
