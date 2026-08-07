# Contributing to nestjs-agentic

Thanks for your interest in contributing. This document covers the practical stuff — how to set up the project, how we work, and what to expect when you submit a PR.

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/your-org/nestjs-agentic.git
cd nestjs-agentic
npm install
npm run build
```

The project uses npm workspaces. `npm install` at the root handles everything.

### Project structure

```
packages/
  core/          → Main library (nestjs-agentic)
  runtime-adk/   → Google ADK adapter (@nestjs-agentic/adk)
examples/
  customer-support/  → Working demo app
```

### Running tests

```bash
# All packages
npm test

# Single package
cd packages/core && npm test
```

### Building

```bash
npm run build
```

### Running the demo

```bash
cd examples/customer-support
cp .env.example .env   # Add your GEMINI_API_KEY
npm run start:dev
```

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

The [Architecture Guide](docs/ARCHITECTURE.md) explains the design decisions behind the library. If you're working on something that touches core abstractions (RuntimeAdapter, ToolProvider, PolicyExecutor), read it first.

Key principles:

- **Core knows nothing about specific runtimes.** No ADK, LangGraph, or OpenAI imports in `packages/core`.
- **Policies live inside tool closures.** RuntimeAdapters don't need to know about policy enforcement.
- **Explicit registration only.** No classpath scanning. Everything goes through `forFeature()`.
- **Deny is a return value, not an exception.** Policy denials come back as `{ success: false, denied: true, reason }`.

## Versioning

We follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.0.x): Bug fixes, documentation updates
- **Minor** (0.x.0): New features, new decorators, new interfaces (backward compatible)
- **Major** (x.0.0): Breaking changes to public API

During 0.x development, minor versions may include breaking changes. We'll document these clearly in the changelog.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
