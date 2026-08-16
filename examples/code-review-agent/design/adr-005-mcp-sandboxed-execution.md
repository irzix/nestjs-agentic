# ADR 005: Model Context Protocol (MCP) Integration for Sandboxed Test Execution

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
When Njent generates automated code fixes (`@njent apply-fixes`), it must verify that the proposed code compiles without TypeScript errors (`tsc --noEmit`) and passes unit tests (`jest --findRelatedTests`).

Executing dynamic shell commands and test runners directly on the host machine using Node.js `child_process.exec()` creates catastrophic security and reliability risks:
1. **Remote Code Execution (RCE):** Malicious dependencies or adversarial tests in a PR could execute arbitrary code on the host server.
2. **Environment Pollution:** Concurrent PR reviews could overwrite local disk files, polluting shared `node_modules` or local git working directories.
3. **Lack of Standard Tool Interoperability:** Custom ad-hoc CLI wrappers are brittle and non-standard across different CI environments.

---

## Decision
We choose a **Dual Tool Architecture**:
1. **Native NestJS `@Tool` Decorators** for fast, trusted in-process operations (GitHub Octokit API, PostgreSQL queries, Redis session state).
2. **Model Context Protocol (MCP) Client over Docker Stdio** (`SandboxMcpToolProvider`) for executing untrusted code fixes, compilers, and test suites in isolated disposable containers.

```
                               ┌───────────────────────────┐
                               │       AgentExecutor       │
                               └─────────────┬─────────────┘
                                             │
                      ┌──────────────────────┴──────────────────────┐
                      ▼                                             ▼
          ┌────────────────────────┐                    ┌────────────────────────┐
          │   Native NestJS @Tool  │                    │   MCP Client Provider  │
          │ (In-Process DI Service)│                    │ (StdioClientTransport) │
          └───────────┬────────────┘                    └───────────┬────────────┘
                      │                                             │
                      ▼                                             ▼
          ┌────────────────────────┐                    ┌────────────────────────┐
          │ • GitHub Octokit API   │                    │ • Docker Container     │
          │ • PostgreSQL RAG Query │                    │ • Isolated File System │
          │ • Redis Session Cache  │                    │ • Sandboxed tsc & jest │
          └────────────────────────┘                    └────────────────────────┘
```

### Key Technical Choices:
1. **Standardized JSON-RPC Protocol:** Uses `@modelcontextprotocol/sdk` to communicate with the sandboxed environment over `stdio`.
2. **Deterministic Pre/Post Conditions:** Validates command arguments against strict schema rules before dispatching via JSON-RPC.
3. **Disposable Container Lifecycles:** Tests execute inside an ephemeral Docker container with read-only root filesystems and restricted CPU/RAM quotas.
4. **Self-Correction Feedback Loop:** Compiler and test runner outputs (stdout/stderr) are piped back to the `CodeFixerAgent` as observations to enable iterative self-correction.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Host `child_process.exec`** | Fast; zero setup. | Extreme security vulnerability (RCE); race conditions on host filesystem; unviable in production. |
| **External CI Trigger (e.g. Triggering GitHub Actions on every fix trial)** | Uses real CI runners. | High latency (2–5 minutes per iteration); consumes GitHub Action runner minutes; slow feedback loop. |
| **Pure LLM Code Simulation (No Test Execution)** | Instantaneous; zero execution cost. | High hallucination rate; cannot guarantee that generated TypeScript code actually compiles. |

---

## Consequences & Trade-offs
* **Positive:** Complete host isolation and RCE protection; standardized tool protocol (MCP); 100% verified code fixes before maintainer review.
* **Negative:** Requires Docker daemon to run sandboxes; adds ~20–40ms IPC overhead per test execution.
