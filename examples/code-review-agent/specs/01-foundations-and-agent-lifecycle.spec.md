# 01 — Foundations & Agent Lifecycle Specification
> **How Njent models agents, turns, state, and bounded lifecycles using the ReAct Grammar.**

---

## 📚 Academic & Research Foundations
* **ReAct: Synergizing Reasoning and Acting in Language Models** — *Yao et al., Princeton & Google Brain (ICLR 2023)* ([arXiv:2210.03629](https://arxiv.org/abs/2210.03629)).
* **The Rise and Potential of Large Language Model Based Agents: A Survey** — *Xi et al. (2023)* ([arXiv:2309.07864](https://arxiv.org/abs/2309.07864)).

---

## 1. Conceptual Mapping in Njent

* **LLM Engine:** Stateless probabilistic model (`ModelAdapter` in `@nestjs-agentic/openai`) generating tokens via ChatCompletions protocol.
* **ReAct Trajectory Grammar:** Strictly interleaving reasoning thoughts with external tool observations:
  $$\text{Thought}_t \longrightarrow \text{Action}_t \longrightarrow \text{Observation}_t \longrightarrow \text{Thought}_{t+1}$$
* **Core Terminology Breakdown:**
  * **Context:** Ephemeral active prompt payload (Sanitized PR diff + Retrieved AST chunks + Instructions).
  * **State:** Execution machine status (`running`, `suspended_for_approval`, `completed`) tracked per turn.
  * **Memory:** Cross-turn conversational history (`RedisSessionStore`) and maintainer feedback (`@nestjs-agentic/memory`).
  * **Knowledge:** Persistent indexed codebase AST and roadmap guidelines stored in PostgreSQL (`pgvector`).
  * **Chunks:** AST-delimited semantic code units (classes, interfaces, methods) rather than arbitrary character splits.
* **Agent Lifecycle:** `Webhook Ingress` ➔ `RBAC Check` ➔ `RAG Retrieval` ➔ `Reasoning Loop` ➔ `Policy Interceptor` ➔ `Quality Evaluation` ➔ `PR Comment Egress`.

---

## 2. Technical Specification

### 2.1 ReAct Trajectory Formatter (`src/agents/react-formatter.ts`)
```typescript
export interface ReActTurn {
  thought: string;
  action?: {
    toolName: string;
    toolInput: Record<string, any>;
  };
  observation?: string;
  finalAnswer?: string;
}
```

### 2.2 Agent Definition Contract (`src/agents/lead-synthesizer.agent.ts`)
```typescript
import { Injectable } from '@nestjs/common';
import { Agent, AgentProvider, AgentConfig } from '@nestjs-agentic/core';

@Injectable()
@Agent({
  name: 'lead_synthesizer',
  description: 'Supervisor agent synthesizing multi-perspective reviews into verified GitHub comments.',
})
export class LeadSynthesizerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      name: 'lead_synthesizer',
      instructions: `You are Njent, the governed PR review supervisor for nestjs-agentic.
Follow the ReAct protocol:
1. Thought: Reason about the findings from security, architecture, and quality workers.
2. Action: Call tools if additional codebase context or diff lines are needed.
3. Observation: Evaluate tool outputs.
4. Final Answer: Synthesize a concise, constructive, actionable GitHub review comment.`,
      tools: ['search_codebase', 'fetch_pr_diff', 'post_pr_review_comment'],
    };
  }
}
```

### 2.3 Execution Budget Boundaries
Every turn is strictly bounded to prevent runaway loops:
```typescript
export const DEFAULT_NJENT_LIMITS = {
  maxTurns: 8,
  maxToolCalls: 12,
  maxDurationMs: 60000,
};
```

---

## 3. Key Design Decisions

* **Formal ReAct Interleaving:** Eliminates ungrounded hallucinations by requiring explicit internal reasoning thoughts before tool invocations.
* **Bounded Autonomy:** Hard ceilings on turns and time prevent infinite loops and unpredictable API bills.
