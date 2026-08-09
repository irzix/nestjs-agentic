<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">@nestjs-agentic/core</h1>

<p align="center">
  <b>Core Primitives, Policy Engine & Execution Layer for nestjs-agentic</b>
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
- **HITL Lifecycle**: `ApprovalService` and in-memory/custom `ApprovalStore`
- **Session Management**: `SessionStore` and context pre-binding
- **Mock Runtime**: `MockRuntimeAdapter` for LLM-free unit testing

## Installation

```bash
npm install @nestjs-agentic/core
```

*(Note: We recommend installing the main meta-package `nestjs-agentic` instead).*

## Documentation & Usage

For full documentation and code examples, see the [nestjs-agentic GitHub Repository](https://github.com/irzix/nestjs-agentic#readme).

## License

MIT © [irzix](https://github.com/irzix)
