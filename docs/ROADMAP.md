# Product Roadmap & Architectural Vision

> **Philosophy**: nestjs-agentic is the **agentic infrastructure layer for NestJS** — not an AI wrapper on top of your backend, but governance, orchestration, and runtime binding built natively inside it. Agents are first-class NestJS citizens. Policies run before every tool call. Humans stay in control of what matters.

---

## The 4 Core Pillars

```
                              nestjs-agentic
                                    │
   ┌────────────────────┬───────────┴────────────┬────────────────────┐
   │                    │                        │                    │
1. NestJS Primitives  2. Governance &         3. Ecosystem         4. Multi-Agent
   & DI Binding          HITL Safety             Adapters             Orchestration
   @Agent, @ToolSet,     3-state policies,       ADK, LangGraph,      Sub-agents,
   @Tool, @Context       ApprovalService         Vercel, MCP          isolated contexts
```

---

## The Agent Execution & Governance Pipeline

```
Incoming Request
      │
      ▼
AgentRunner.run('agent-name', { sessionId, message, context })
      │
      ▼
AgentProvider.define()   ─── resolves tools and instructions
      │
      ▼
LocalToolProvider        ─── wraps each @Tool method into a ResolvedTool closure
      │
      ▼
PolicyExecutor           ─── evaluates @UsePolicies chain per tool call
      ├── allow           ──► Execute tool, return result to LLM
      ├── deny            ──► Return { status: 'denied', reason } to LLM
      └── require_approval──► Save PendingApproval, return { status: 'pending_approval', approvalId }
                                    │
                                    ▼
                            POST /approve/:id   ──► ApprovalService.approve()  ──► Execute saved closure
                            POST /reject/:id    ──► ApprovalService.reject()   ──► Discard
```

---

## Release Phases

---

### ✅ Phase 0.1 — Core Primitives & Safety Foundation

> **Status: Released**

The foundation. Every subsequent phase builds on these.

- [x] **Decorator Suite**: `@Agent()`, `@ToolSet()`, `@Tool()`, `@Param()`, `@Context()` — full NestJS DI integration.
- [x] **3-State Policy Engine**: `allow`, `deny`, `require_approval` — composable via `@UsePolicies(...policies)`.
- [x] **AgentContext Isolation**: `security.userId`, `security.tenantId`, `security.roles`, `traceId` — captured inside tool closures, never leaking through LLM prompts.
- [x] **HITL Approval Lifecycle**: `ApprovalService.approve(id)` and `ApprovalService.reject(id)` — full pending approval management.
- [x] **Google ADK Adapter**: Official `@nestjs-agentic/adk` runtime adapter for Gemini models.
- [x] **MockRuntimeAdapter**: Deterministic unit testing of agents, tools, and policies — no LLM API keys required.
- [x] **Modular Architecture**: `@nestjs-agentic/core`, `@nestjs-agentic/adk`, and `nestjs-agentic` meta-package via `AgenticModule.forRoot()` / `forFeature()`.

---

### 🔥 Phase 0.2 — Enterprise Governance Matrix & Ecosystem

> **Status: Active Development**

Where nestjs-agentic becomes irreplaceable for enterprise teams.

#### 🛡️ Advanced Governance & Multi-Tenant Safety

- [ ] **Composite Policy Utilities** — production-ready policy building blocks:
  - `TenantIsolationPolicy` — hard data boundary enforcement at the policy layer. No cross-tenant tool execution.
  - `TieredApprovalPolicy` — multi-threshold auto-routing: `< $100` auto-allow → `$100–$500` owner check → `$500–$5000` finance HITL → `> $5000` deny.
  - `RiskScorePolicy` — evaluates argument risk vectors before any tool executes.
- [ ] **Role-Aware HITL Approvals** — bind pending approvals to organizational roles (`requiredRole: 'finance_manager'`). Approval endpoints validate actor roles before executing.

#### 🤖 Multi-Agent Orchestration

- [ ] **Sub-Agent Delegation** — define `subAgents` in `AgentConfig`. Each sub-agent gets isolated governance context and its own policy pipeline. Parent agents can delegate and await results.

#### 🔌 Ecosystem Adapters & Transports

- [ ] **`@nestjs-agentic/vercel`** — Vercel AI SDK runtime adapter with streaming support.
- [x] **`@nestjs-agentic/langgraph`** — LangGraph runtime adapter for graph-based agent flows.
- [ ] **MCP Transport** — Model Context Protocol `ToolProvider` for exposing tools to external MCP-compatible servers and clients.

---

### 📡 Phase 0.3 — Observability, Compliance & Audit Trail

> **Status: Upcoming**

Make every agent action auditable and traceable.

- [ ] **Immutable Audit Trail (`AuditEventStore`)** — persistent, append-only log of all policy decisions, tool executions, approvals, and rejections. Designed for EU AI Act and SOC 2 compliance requirements.
- [ ] **AgentObserver Interface** — pluggable observer hooks for the full agent lifecycle:
  - `OpenTelemetry` exporter for distributed tracing.
  - `Langfuse` integration for LLM call analytics and evaluation.
  - `Arize Phoenix` integration for agent performance monitoring.
- [ ] **`@nestjs-agentic/experience`** — Experience learning & trajectory reflection layer for agent self-improvement and memory persistence.

---

### 🏭 Phase 1.0 — Durable & Distributed Execution

> **Status: Planned**

Production-grade agentic systems that survive restarts, scale horizontally, and coordinate across instances.

- [ ] **Durable HITL Workflows** — `Temporal.io` and `BullMQ` integrations. Human approval workflows persist across process restarts — no approvals lost on deploy.
- [ ] **Distributed Approval & Session Stores** — built-in `RedisApprovalStore` and `RedisSessionStore` for multi-instance production deployments. Drop-in replacement via DI token override:

  ```typescript
  { provide: APPROVAL_STORE, useClass: RedisApprovalStore }
  { provide: SESSION_STORE,  useClass: RedisSessionStore }
  ```

---

## Design Principles

These principles guide every decision in the roadmap:

1. **NestJS-Native First** — If it doesn't fit into the NestJS module system naturally, we don't ship it.
2. **Governance is Non-Optional** — Every tool call passes through the policy engine. There is no bypass.
3. **Context Isolation by Default** — `AgentContext` is pre-bound inside closures. LLMs never have access to raw security data.
4. **Vendor-Agnostic Runtime** — The `RuntimeAdapter` interface decouples tool definitions from LLM providers entirely.
5. **Testable Without LLMs** — `MockRuntimeAdapter` ensures every governance decision is testable in CI without API keys or network calls.
