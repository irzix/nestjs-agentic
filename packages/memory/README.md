# @nestjs-agentic/memory

Cognitive multi-factor memory primitives and procedural workflow stores for governed AI agents in NestJS.

---

## Capabilities & Stores

- **Stanford Tri-Factor Memory Scoring (`GenerativeMemoryStore`, `StanfordMemoryScorer`)**:
  - Implements the foundational cognitive memory ranking algorithm from *Park et al. (Stanford University & Google, 2023, arXiv:2304.03442 — Generative Agents)*.
  - $\text{Score}(m, q) = \alpha \cdot \hat{R}(m) + \beta \cdot \hat{I}(m) + \gamma \cdot \hat{S}(m, q)$
  - Computes exponential **Recency Decay** ($e^{-\lambda \Delta t}$), cognitive **Importance** ($[0, 1]$), and semantic **Relevance** (cosine vector or lexical token overlap) with Min-Max candidate normalization.
- **Procedural Memory Store (`ProceduralMemoryStore`)**:
  - Manages deterministic multi-step Standard Operating Procedures (SOPs), playbooks, and execution sequences for governance agents (e.g. PR reviewers, security auditing).
  - Matches playbooks by task triggers/keywords and formats them directly into structured prompt instructions.
- **ShortTermMemory**: Sliding-window conversation records per `sessionId`.
- **ScratchpadMemory**: Ephemeral task state and working scratchpad for agent iterations.
- **SemanticMemory**: Vector and semantic memory backed by basic or custom `SemanticStoreProvider`.
- **EpisodicMemory**: Chronological timeline of past trajectory events.
- **CompositeMemory**: Unifies multiple memory tiers behind a single `AgentMemoryStore`.

---

## Installation

```bash
npm install @nestjs-agentic/memory nestjs-agentic
```

---

## Usage

### 1. Stanford Tri-Factor Memory Retrieval (`GenerativeMemoryStore`)

```typescript
import { GenerativeMemoryStore } from '@nestjs-agentic/memory';

const memory = new GenerativeMemoryStore({
  defaultWeights: { recency: 0.3, importance: 0.3, relevance: 0.4 },
  defaultDecayOptions: { halfLifeHours: 24 }, // 24-hour exponential decay half-life
});

// Save memories with cognitive importance ratings
await memory.save({
  id: 'mem_1',
  sessionId: 'user_42',
  type: 'generative',
  content: 'User prefers dark mode UI and high contrast typography',
  importance: 0.85,
});

await memory.save({
  id: 'mem_2',
  sessionId: 'user_42',
  type: 'generative',
  content: 'Critical governance constraint: User lacks financial transfer approval role',
  importance: 0.98,
});

// Recalls top ranked memories balancing recency, importance, and query relevance
const memories = await memory.recall('user interface preferences', {
  sessionId: 'user_42',
  limit: 5,
  minScoreCutoff: 0.5,
});
```

### 2. Procedural Memory & SOP Playbooks (`ProceduralMemoryStore`)

```typescript
import { ProceduralMemoryStore } from '@nestjs-agentic/memory';

const procedural = new ProceduralMemoryStore();

await procedural.savePlaybook({
  id: 'pb_code_review',
  name: 'Pull Request Security & Governance Audit',
  description: 'Examines PR diffs for OWASP Top 10 vulnerabilities and dependency tampering',
  triggers: ['code_review', 'pull_request', 'security_audit'],
  prerequisites: ['tool:git_diff', 'role:reviewer'],
  steps: [
    {
      stepNumber: 1,
      title: 'Fetch Git Diff',
      description: 'Extract changed files and hunk patches from target PR',
      toolName: 'get_pr_diff',
      onFailure: 'abort',
    },
    {
      stepNumber: 2,
      title: 'Static Security Scan',
      description: 'Check for hardcoded secrets, injection vectors, and risky eval calls',
      toolName: 'ast_security_scan',
      onFailure: 'escalate_hitl',
    },
  ],
});

// Match playbooks for an incoming agent task
const matches = await procedural.matchPlaybooks('review pull request for vulnerabilities');

// Format directly into structured prompt guidance
const promptSection = procedural.formatPlaybookInstructions(matches[0].playbook);
```

---

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
