# Architecture Guide

This document details the architecture of **nestjs-agentic** as an AI Integration Layer for NestJS, focusing on tool resolution, closure-based policy enforcement, and working Human-in-the-Loop (HITL) approval mechanics.

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

```
1. LLM attempts sensitive tool invocation (e.g., refundOrder($600))
   │
2. Tool Closure evaluates @UsePolicies(RefundLimitPolicy)
   │
3. Policy returns { decision: 'require_approval', reason: 'Exceeds limit' }
   │
4. Tool Closure stores PendingApproval & generates approvalId
   │
5. Tool Closure returns { status: 'pending_approval', approvalId: 'app_123' } to LLM
   │
6. LLM responds to user: "Approval requested with ID app_123"
   │
7. Supervisor calls NestJS Endpoint: POST /support/approve/app_123
   │
8. ApprovalService.approve('app_123'):
   ├── Retrieves stored args & context
   ├── Invokes target tool method
   └── Clears PendingApproval from ApprovalStore
```
