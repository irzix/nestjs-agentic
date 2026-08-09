# Architecture Guide

This document details the architecture of **nestjs-agentic** as an Agentic Infrastructure & Governance Layer for NestJS, focusing on tool resolution, closure-based policy enforcement, and working Human-in-the-Loop (HITL) approval mechanics.

---

## Visual Architecture Overview

```mermaid
flowchart TD
    subgraph Client["Client Layer"]
        REQ["Incoming Request (HTTP / SSE / Queue)"]
    end

    subgraph NestJS["NestJS Application Core"]
        CTRL["SupportController"]
        RUNNER["AgentRunner.run('customer-support')"]
        AGENT["SupportAgent (AgentProvider)"]
        TOOLS["OrderTools (@ToolSet)"]
        POLICY["PolicyExecutor (@UsePolicies)"]
        LOCAL_PROV["LocalToolProvider (ResolvedTool)"]
        APPROVAL_SVC["ApprovalService"]
        APP_STORE[("ApprovalStore (InMemory / Redis)")]
    end

    subgraph Governance["Governance & HITL Decisions"]
        DECISION_ALLOW["decision: 'allow'"]
        DECISION_DENY["decision: 'deny'"]
        DECISION_HITL["decision: 'require_approval'"]
        HUMAN_EP["Human Approval Endpoint (/approve/:approvalId)"]
    end

    subgraph AI["LLM Execution Layer"]
        ADAPTER["RuntimeAdapter (ADK / Mock / Vercel)"]
        LLM["LLM Provider (Gemini / GPT / Claude)"]
    end

    REQ --> CTRL
    CTRL --> RUNNER
    RUNNER --> AGENT
    AGENT --> TOOLS
    TOOLS --> POLICY

    POLICY -->|Allowed| DECISION_ALLOW
    POLICY -->|Denied| DECISION_DENY
    POLICY -->|Approval Required| DECISION_HITL

    DECISION_ALLOW --> LOCAL_PROV
    DECISION_DENY -->|Denied Result| LLM

    DECISION_HITL -->|Save PendingApproval| APP_STORE
    APP_STORE -.->|Generates approvalId| APPROVAL_SVC
    APPROVAL_SVC -.->|Pending Approval Result| LLM
    
    HUMAN_EP -->|POST /approve/:id| APPROVAL_SVC
    APPROVAL_SVC -->|Execute Saved Tool Closure| LOCAL_PROV

    LOCAL_PROV --> ADAPTER
    ADAPTER --> LLM
```

---

## Tool Closure & Policy Engine Mechanics

When `LocalToolProvider` scans a `@ToolSet` provider, it wraps each tool method into a `ResolvedTool` closure:

```
What RuntimeAdapter sees:

  tool.execute(input) → Promise<ToolExecutionResult>

Execution Pipeline inside closure:

  1. PolicyExecutor.evaluate(policies, ctx, args)
     ├── decision: 'deny'
     │    └── return { success: false, status: 'denied', reason }
     │
     ├── decision: 'require_approval'
     │    ├── PendingApproval stored in ApprovalStore (approvalId generated)
     │    └── return { success: false, status: 'pending_approval', reason, approvalId }
     │
     └── decision: 'allow'
          └── invoke target method with mapped args + injected @Context
               └── return { success: true, data }
```

---

## Human-in-the-Loop (HITL) Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Controller as SupportController
    participant Runner as AgentRunner
    participant Policy as PolicyExecutor
    participant Store as ApprovalStore
    participant LLM as LLM Provider
    actor Supervisor

    User->>Controller: POST /support/chat ("Refund $600 for order #123")
    Controller->>Runner: run("customer-support")
    Runner->>Policy: evaluate(RefundLimitPolicy)
    Policy-->>Runner: decision: 'require_approval'
    Runner->>Store: save(PendingApproval)
    Store-->>Runner: approvalId: "app_98765"
    Runner-->>LLM: { status: "pending_approval", approvalId: "app_98765" }
    LLM-->>User: "Refund requires approval (ID: app_98765)"

    Note over Supervisor, Store: Asynchronous Human Approval Step
    Supervisor->>Controller: POST /support/approve/app_98765
    Controller->>Store: get("app_98765")
    Store-->>Controller: PendingApproval (args & context)
    Controller->>Controller: Execute OrderTools.refundOrder()
    Controller-->>Supervisor: { success: true, data: { refunded: true } }
```

---

## Token-based Dependency Injection

Adapters and stores are registered using standard NestJS DI Tokens:

```typescript
{ provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter },
{ provide: APPROVAL_STORE, useClass: InMemoryApprovalStore }
```

This allows adapters and approval stores to inject NestJS services like `ConfigService` or `HttpService` naturally.
