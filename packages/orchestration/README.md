# @nestjs-agentic/orchestration

Multi-agent coordination, sub-agent delegation, parallel execution, iterative refinement loops, and capability narrowing for `nestjs-agentic`.

---

## Features

- **Immutable Multi-Tenant Isolation**: Sub-agents strictly inherit the parent's `tenantId` without cross-tenant leakage or forging.
- **Capability Narrowing (Least Privilege)**: Granular restrictions for subordinate executions including tool whitelists (`allowedTools`), tool blacklists (`deniedTools`), permission/role subsetting, and execution limits (`limits`).
- **Distributed Trace Hierarchy**: Automatically propagates `parentTraceId` and `rootTraceId` across sub-agent execution trees for OpenTelemetry GenAI observability.
- **Recursion & Depth Guards**: Configurable `maxDelegationDepth` preventing runaway recursive delegation loops.
- **Parallel Fan-Out Execution (`ParallelSubAgentRunner`)**: Concurrent execution with bounded concurrency pools, timeouts, retries, fallback sub-agents, and consensus merge aggregation.
- **Iterative Refinement Loops (`RefinementLoopRunner`)**: Supervisor-worker loop with evaluation predicates, versioned session memory, and feedback loops.

---

## Installation

```bash
npm install @nestjs-agentic/orchestration @nestjs-agentic/core
```

---

## Usage Examples

### 1. Sub-Agent Delegation with Capability Narrowing

```typescript
import { Injectable } from '@nestjs/common';
import { AgentRunner, AgentContext } from '@nestjs-agentic/core';
import { SubAgentDelegator } from '@nestjs-agentic/orchestration';

@Injectable()
export class SupervisorService {
  private readonly delegator: SubAgentDelegator;

  constructor(private readonly runner: AgentRunner) {
    this.delegator = new SubAgentDelegator(this.runner, {
      maxDelegationDepth: 3, // Guard against infinite delegation recursion
    });
  }

  async delegateFinancialTask(parentContext: AgentContext) {
    // Sub-agent delegated with restricted tool whitelist & execution budget
    const result = await this.delegator.delegate(parentContext, {
      agentName: 'reporting_analyst',
      message: 'Generate quarterly financial report',
      narrowing: {
        // Only allow read-only data fetching; block state mutations
        allowedTools: ['fetchFinancialStatements', 'computeMetrics'],
        deniedTools: ['transferFunds', 'deleteAccount'],
        // Narrow permissions (must be a subset of parent permissions)
        allowedPermissions: ['read:finance'],
        // Strict resource budgets for the sub-agent run
        limits: {
          maxIterations: 5,
          maxTotalTokens: 10000,
          timeoutMs: 30000,
        },
      },
    });

    if (result.status === 'success') {
      console.log('Report generated:', result.response);
    }
  }
}
```

### 2. Parallel Fan-Out Execution (`ParallelSubAgentRunner`)

```typescript
import { ParallelSubAgentRunner } from '@nestjs-agentic/orchestration';

const parallelRunner = new ParallelSubAgentRunner(runner, {
  aggregationStrategy: 'consensusMerge', // 'allSettled' | 'firstSuccess' | 'consensusMerge'
  timeoutMs: 45000,
  maxConcurrency: 3, // Bound concurrent sub-agent executions
  retriesPerSubAgent: 1,
  fallbackAgentName: 'general_assistant', // Fallback on persistent failure
});

const runResult = await parallelRunner.runParallel(parentContext, [
  { agentName: 'security_reviewer', message: codeDiffPrompt },
  { agentName: 'architecture_reviewer', message: codeDiffPrompt },
  { agentName: 'quality_reviewer', message: codeDiffPrompt },
]);

console.log(`Completed: ${runResult.successCount} succeeded, ${runResult.failedCount} failed.`);
console.log('Synthesized Response:\n', runResult.combinedResponse);
```

### 3. Supervisor-Worker Iterative Refinement Loop (`RefinementLoopRunner`)

```typescript
import { RefinementLoopRunner, SubAgentResult } from '@nestjs-agentic/orchestration';

const refinementRunner = new RefinementLoopRunner(runner, {
  maxIterations: 3,
  qualityThreshold: 0.90,
  satisfactionFn: async (result: SubAgentResult, iteration: number) => {
    return result.response.includes('QUALITY_GATE: PASSED');
  },
});

const loopResult = await refinementRunner.runLoop(
  parentContext,
  {
    agentName: 'copywriter_agent',
    message: 'Draft landing page value proposition',
  },
  async (lastResult: SubAgentResult, iteration: number) => {
    return `Iteration ${iteration} Feedback: Make the headline punchier and include performance metrics.`;
  },
);

console.log(`Finished in ${loopResult.iterations} iterations (Satisfied: ${loopResult.satisfied})`);
console.log('Final Result:\n', loopResult.finalResponse);
```

---

## Tool Governance with `CapabilityNarrowingPolicy`

To enforce capability narrowing on tool calls, register `CapabilityNarrowingPolicy` in your ToolSets:

```typescript
import { ToolSet, Tool, UsePolicies } from '@nestjs-agentic/core';
import { CapabilityNarrowingPolicy } from '@nestjs-agentic/orchestration';

@ToolSet({ name: 'finance' })
export class FinanceToolSet {
  @Tool({ name: 'getBalance', description: 'Retrieve account balance' })
  @UsePolicies(CapabilityNarrowingPolicy)
  getBalance() {
    return { balance: 5000 };
  }

  @Tool({ name: 'transferFunds', description: 'Transfer funds' })
  @UsePolicies(CapabilityNarrowingPolicy)
  transferFunds(@Param('amount') amount: number) {
    return { status: 'transferred', amount };
  }
}
```

---

## License

MIT
