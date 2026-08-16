# 06 — Memory & Experience Specification
> **Comprehensive specification of all 5 Memory Types, Experience, Reflection, and Human Feedback in Njent.**

---

## 📚 Academic & Research Foundations
* **Generative Agents: Interactive Simulacra of Human Behavior** — *Park et al., Stanford University & Google (UIST 2023)* ([arXiv:2304.03442](https://arxiv.org/abs/2304.03442)).
* **Reflexion: Language Agents with Verbal Reinforcement Learning** — *Shinn et al., MIT & Northeastern (NeurIPS 2023)* ([arXiv:2303.11366](https://arxiv.org/abs/2303.11366)).

---

## 1. Concrete Mapping of All Memory Concepts in Njent

Njent implements a **5-Tier Memory & Experience Architecture** directly implementing the principles of *Park et al. (Stanford)* and *Shinn et al. (MIT)*:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                   NJENT MEMORY SYSTEM                                 │
├───────────────────────────┬───────────────────────────────────────────────────────────┤
│ 1. Short-Term Memory      │ • RedisSessionStore: Active PR conversation turns         │
│    (Working Memory)       │ • ScratchpadState: Active tool results & intermediate reasoning │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 2. Long-Term Memory       │ • PostgreSQL Persistent Store: Cross-PR historical memory │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 3. Semantic Memory        │ • SemanticMemoryStore: Declarative architectural rules,  │
│    (Facts & Concepts)     │   coding conventions, and framework design constraints     │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 4. Episodic Memory        │ • EpisodicExperienceStore: Specific past PR review events,│
│    (Specific Past Events) │   past maintainer discussions, and specific PR diff episodes│
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 5. Procedural Memory      │ • ProceduralPlaybookStore: Step-by-step instructions on   │
│    (How-To Workflows)     │   HOW to run tests, create fix branches, and format diffs │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 6. Experience             │ • ExperienceRecord: Generalized lessons synthesized from  │
│    (Synthesized Lessons)  │   multiple episodic events                                │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 7. Reflection             │ • ReflectionEngine: Automated self-critique analyzing     │
│    (Self-Introspection)   │   past reviews vs. actual merged PR code to spot mistakes │
├───────────────────────────┼───────────────────────────────────────────────────────────┤
│ 8. Human Feedback         │ • Maintainer Signals: GitHub reactions (👍/👎), comments, │
│    (Reinforcement Signals)│   and @njent false-positive explanations                  │
└───────────────────────────┴───────────────────────────────────────────────────────────┘
```

---

## 2. Technical Specification & Code Contracts

### 2.1 Memory Retrieval Formula (Park et al., Stanford)
When querying the Episodic Experience Store, items are ranked by the Stanford Tri-Factor Scoring Formula:
$$\text{Score}(m) = \alpha \cdot \text{Recency}(m) + \beta \cdot \text{Importance}(m) + \gamma \cdot \text{Relevance}(m, q)$$
where $\alpha = 0.25$, $\beta = 0.25$, and $\gamma = 0.50$.

```typescript
export class StanfordMemoryScorer {
  static computeScore(recencyDays: number, importanceScore: number, cosineSim: number): number {
    const recencyDecay = Math.pow(0.95, recencyDays);
    return 0.25 * recencyDecay + 0.25 * importanceScore + 0.5 * cosineSim;
  }
}
```

### 2.2 Short-Term & Working Memory (`RedisSessionStore` + Scratchpad)
Manages the immediate multi-turn thread on a PR:
```typescript
import { Injectable } from '@nestjs/common';
import { SessionStore, SessionRecord, ModelMessage } from '@nestjs-agentic/core';
import { Redis } from 'ioredis';

@Injectable()
export class NjentSessionMemory implements SessionStore {
  constructor(private readonly redis: Redis) {}

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(`session:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async saveMessages(sessionId: string, messages: ModelMessage[]): Promise<void> {
    // Sliding window: keeps last 12 messages of the PR conversation
    const trimmed = messages.slice(-12);
    await this.redis.set(`session:${sessionId}`, JSON.stringify({ messages: trimmed }), 'EX', 604800); // 7 days TTL
  }
}
```

### 2.3 Semantic Memory (`SemanticMemoryStore`)
Stores generalized facts and coding conventions extracted from repository docs:
```typescript
export interface SemanticFact {
  id: string;
  category: 'architecture_rule' | 'coding_standard' | 'security_rule';
  concept: string;       // e.g. "Tool Policy Governance"
  ruleStatement: string; // e.g. "All state-modifying tools MUST use @UsePolicies(RequireApproval)"
  embedding: number[];
}

@Injectable()
export class SemanticMemoryService {
  async recallRelevantRules(prDiff: string): Promise<string[]> {
    // Vector search in semantic memory table
    return db.query(`SELECT rule_statement FROM semantic_memory_rules ORDER BY embedding <=> $1 LIMIT 3`, [embed(prDiff)]);
  }
}
```

### 2.4 Episodic Memory (`EpisodicExperienceStore`)
Records concrete historical events that occurred on specific PRs:
```typescript
export interface EpisodicEvent {
  id: string;
  sourcePr: number;
  fileModified: string;
  lineRange: [number, number];
  maintainerAction: 'accepted' | 'dismissed' | 'marked_false_positive';
  commentSummary: string;
  importanceScore: number; // 0.0 to 1.0
  maintainerExplanation?: string;
  createdAt: Date;
}
```

### 2.5 Procedural Memory (`ProceduralPlaybookStore`)
Stores step-by-step workflow procedures so the agent knows exact execution sequences:
```typescript
export interface ProceduralPlaybook {
  taskName: 'create_fix_branch_and_commit' | 'verify_typescript_types' | 'run_unit_tests';
  requiredSteps: string[];
  toolSequence: string[];
  safetyPreconditions: string[];
}

export const PROCEDURAL_PLAYBOOKS: Record<string, ProceduralPlaybook> = {
  create_fix_branch_and_commit: {
    taskName: 'create_fix_branch_and_commit',
    safetyPreconditions: ['RequireMaintainerApprovalPolicy must return allow'],
    toolSequence: ['run_type_check', 'run_unit_tests', 'git_create_branch', 'git_commit_push'],
    requiredSteps: [
      '1. Verify TypeScript compiles with zero errors (tsc --noEmit)',
      '2. Execute related unit tests (jest --findRelatedTests)',
      '3. Create branch njent/fix-pr-<number>',
      '4. Commit changes with Conventional Commit syntax',
    ],
  },
};
```

### 2.6 Reflection Engine (`ReflectionEngine` — Shinn et al., Reflexion)
Periodically inspects past closed PRs to compare Njent’s review predictions against what was actually merged:
```typescript
@Injectable()
export class NjentReflectionEngine {
  async reflectOnMergedPR(prNumber: number, botReviewComments: string[], finalMergedDiff: string) {
    // Verbal reflection extraction without model weight modification
    const prompt = `Analyze if our bot review comments on PR #${prNumber} were accurate or false positives based on the final merged diff:\nReview: ${botReviewComments}\nMerged Diff: ${finalMergedDiff}`;
    
    const reflection = await this.model.execute({ messages: [{ role: 'user', content: prompt }] });
    
    // Automatically stores learned verbal lessons into Experience Store
    await this.experienceService.recordLesson(reflection.content);
  }
}
```

---

## 3. Key Design Decisions

* **Scientific Memory Scoring:** Implements Park et al.'s tri-factor formula, weighting relevance, recency decay, and importance.
* **Verbal Reinforcement Learning (Reflexion):** Uses self-reflective text generation rather than expensive gradient updates to continuously improve review precision.
