# 12 — Governance & Policies Specification
> **How Njent enforces policy boundaries, human approvals, and compliance.**

---

## 📚 Academic & Research Foundations
* **Artificial Intelligence Risk Management Framework (AI RMF 1.0)** — *National Institute of Standards and Technology (NIST)* ([NIST AI 100-1](https://doi.org/10.6028/NIST.AI.100-1)).
* **Governing Autonomous AI Agents: Policy Boundaries and Safe Execution** — *Stanford HAI Policy Research (2024)*.

---

## 1. Conceptual Mapping in Njent

* **Agent Governance:** Enforcing organizational safety constraints outside the model's probabilistic reasoning.
* **Policy Interception:** Every `@Tool` invocation crosses a policy boundary evaluated before side-effects occur.
* **Decisions:**
  * `allow`: Execute immediately.
  * `deny`: Block execution and return a policy error to the model.
  * `require_approval`: Suspend execution, save a durable checkpoint, and wait for human sign-off.
* **Human Oversight:** One-click maintainer approval via web UI or `@njent approve <id>` comment.

---

## 2. Technical Specification

### Human-in-the-Loop Policy (`src/policies/require-approval.policy.ts`)
```typescript
import { Injectable } from '@nestjs/common';
import { ToolPolicy, PolicyDecision, ResolvedTool, AgentContext } from '@nestjs-agentic/core';

@Injectable()
export class RequireMaintainerApprovalPolicy implements ToolPolicy {
  async evaluate(tool: ResolvedTool, args: any, ctx: AgentContext): Promise<PolicyDecision> {
    if (['create_fix_branch_and_commit', 'approve_pull_request'].includes(tool.name)) {
      return {
        action: 'require_approval',
        reason: `Action "${tool.name}" on PR #${ctx.metadata.prNumber} requires maintainer authorization.`,
        ttlSeconds: 86400, // 24-hour approval TTL
      };
    }
    return { action: 'allow' };
  }
}
```

### Approval Settlement Endpoint
```typescript
@Post(':id/settle')
async settleApproval(@Param('id') approvalId: string, @Body() body: { decision: 'approved' | 'rejected'; actor: string }) {
  const approval = await this.approvalService.resolve(approvalId, body.decision, body.actor);
  if (body.decision === 'approved') {
    return this.agentRunner.resumeTurn(approval); // Resumes turn from durable checkpoint
  }
  return { status: 'rejected' };
}
```

---

## 3. Key Design Decisions

* **Zero Direct Commits:** Code modification tools *always* require human maintainer sign-off.
* **Durable Redis Checkpointing:** Suspended approvals survive server restarts and pod rescheduling.
