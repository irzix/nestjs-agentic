# Product Roadmap & Governance Vision

> **Philosophy**: Most AI frameworks focus solely on orchestration. **nestjs-agentic** focuses on **Agent Governance & Safety** — ensuring LLMs operate securely within enterprise boundaries using native NestJS primitives.

---

## 🎯 Core Value Proposition: The Agent Governance Pipeline

```
LLM Execution Request
         │
    Tool Requested
         │
    Policy Evaluation Pipeline (Async)
         │
 ┌───────┼───────────────┬─────────────────┐
 │       │               │                 │
allow   deny      require_approval    tenant_violation
 │       │               │                 │
execute reject      HITL Workflow        deny & audit
 │       │               │                 │
└───────┴───────────────┴─────────────────┘
                         │
                 Audit & Telemetry Log
```

---

## 🗺️ Release Phases

### Phase 0.1 — Core Primitives & Safety Foundation (Current Released)

- [x] **NestJS-Native Decorators**: `@Agent()`, `@ToolSet()`, `@Tool()`, `@Param()`, `@Context()`.
- [x] **3-State Policy Guardrails**: `allow`, `deny`, and `require_approval` (HITL).
- [x] **Context Pre-Binding & Isolation**: `AgentContext` captured inside tool closures — zero LLM prompt leakage.
- [x] **Built-in Mock Adapter**: `MockRuntimeAdapter` for unit testing policies without real LLM API calls.
- [x] **Google ADK Adapter**: Official `@nestjs-agentic/adk` runtime adapter.
- [x] **Modular Monorepo Architecture**: `@nestjs-agentic/core`, `@nestjs-agentic/adk`, and `nestjs-agentic` meta-package.

---

### Phase 0.2 — Enterprise Governance Matrix & Ecosystem Adapters (In Progress)

#### 🛡️ Advanced Governance & Multi-Tenant Safety
- [ ] **Composite Policy Utilities**:
  - `TenantIsolationPolicy`: Guarantees multi-tenant data boundaries at the policy level.
  - `TieredApprovalPolicy`: Multi-tier thresholds (e.g., `< $100` auto-allow, `$100-$500` owner check, `$500-$5000` finance HITL, `> $5000` deny).
  - `RiskScorePolicy`: Evaluates tool argument risk vectors before execution.
- [ ] **Role-Aware HITL Approvals**: Assign required organizational roles to pending approvals (`requiredRole: 'finance_manager'`).

#### 🤖 Multi-Agent Orchestration
- [ ] **Sub-Agent Delegation**: Delegate sub-tasks across sub-agents via `AgentConfig.subAgents` with isolated sub-context governance.

#### 🔌 Ecosystem Adapters & Transports
- [ ] **Vercel AI SDK Adapter**: `@nestjs-agentic/vercel` runtime adapter.
- [ ] **LangGraph Adapter**: `@nestjs-agentic/langgraph` runtime adapter.
- [ ] **MCP Transport**: Model Context Protocol `ToolProvider` support for external MCP servers.

---

### Phase 0.3 — Observability, Compliance & Audit Trail

- [ ] **Immutable Audit Trail (`AuditEventStore`)**: Persistent audit logging for all policy decisions and tool executions (EU AI Act & SOC2 compliance).
- [ ] **Observability Observers (`AgentObserver`)**:
  - OpenTelemetry exporter.
  - Langfuse & Arize Phoenix telemetry integrations.

---

### Phase 1.0 — Durable & Distributed Execution

- [ ] **Durable HITL Workflows**: Temporal.io & BullMQ integrations to handle human approval workflows that survive process restarts.
- [ ] **Distributed Session Management**: Built-in Redis session and approval stores for multi-instance production deployments.
