# ADR 007: 5-Tier Memory Hierarchy with Stanford Scoring and Verbal Reflexion

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
Large Language Models are inherently stateless. When Njent reviews pull requests across weeks and months, two major limitations emerge:
1. **Repeating Past False Positives:** If a maintainer dismisses a bot review comment on PR #12 with *"This pattern is intentional because of X"*, the agent without long-term memory will repeatedly flag the same pattern on PR #15 and PR #20.
2. **Cost & Infeasibility of Continuous Fine-Tuning:** Continuously fine-tuning model weights on repository feedback is cost-prohibitive, introduces catastrophic forgetting, and requires hours of GPU pipeline runs.
3. **Flat Vector Retrieval Flaws:** Simple semantic search retrieves old, outdated lessons with the same weight as recent maintainer feedback.

---

## Decision
We choose a **5-Tier Memory Architecture** combining **Stanford Tri-Factor Memory Scoring** (*Park et al., Stanford/Google*) with **Verbal Reflexion Learning** (*Shinn et al., MIT*).

```
                      ┌──────────────────────────────────────────────┐
                      │              Njent Memory Stack              │
                      └──────────────────────┬───────────────────────┘
                                             │
             ┌───────────────────────────────┼───────────────────────────────┐
             ▼                               ▼                               ▼
  ┌──────────────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
  │ 1. Working Memory    │        │ 2. Semantic Memory   │        │ 3. Episodic Memory   │
  │ • RedisSessionStore  │        │ • Architectural rules│        │ • Past PR review logs│
  │ • Active PR sliding  │        │ • Framework standards│        │ • Maintainer signals │
  │   window (12 turns)  │        │ • pgvector search    │        │ • False-positive tags│
  └──────────────────────┘        └──────────────────────┘        └──────────┬───────────┘
                                                                             │
             ┌───────────────────────────────────────────────────────────────┘
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │           Stanford Tri-Factor Scoring Engine (Park et al.)       │
  ├──────────────────────────────────────────────────────────────────┤
  │ Score(m) = 0.25 * Recency(m) + 0.25 * Importance(m) + 0.50 * Sim │
  └──────────────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │              MIT Reflexion Engine (Shinn et al.)                 │
  ├──────────────────────────────────────────────────────────────────┤
  │ Synthesizes verbal lessons from maintainer corrections & commits │
  │ Injects learned guidelines into future specialist prompt turns   │
  └──────────────────────────────────────────────────────────────────┘
```

### Key Technical Choices:
1. **Separation of Memory Concerns:**
   * **Working Memory (Redis):** Fast in-memory buffer storing the active PR conversation turns with 7-day TTL.
   * **Semantic Memory (Postgres pgvector):** Permanent architectural facts, invariants, and coding conventions.
   * **Episodic Memory (Postgres relational + embeddings):** Concrete events, maintainer thumbs-up/down reactions, and false-positive dismissal explanations.
   * **Procedural Memory (Playbooks):** Deterministic code execution workflows (e.g. test verification and branch creation).
2. **Stanford Tri-Factor Retrieval Formula:**
   $$\text{Score}(m) = \alpha \cdot \text{Recency}(m) + \beta \cdot \text{Importance}(m) + \gamma \cdot \text{Relevance}(m, q)$$
   * $\text{Recency}(m) = 0.95^{\text{days}}$ (Exponential decay over time).
   * $\text{Importance}(m) \in [0.0, 1.0]$ (Security lessons scored $1.0$; formatting scored $0.2$).
   * $\text{Relevance}(m, q)$ (Cosine similarity between memory embedding and active PR diff).
3. **Verbal Reflexion Loop:**
   * When a maintainer reacts with thumbs-down or comments `@njent false-positive <reason>`, `ReflectionEngine` generates a natural language lesson: *"On module X, do not flag pattern Y because Z."*
   * This verbal lesson is persisted to the Episodic Store and automatically recalled in future reviews matching that module.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Continuous Model Fine-Tuning** | Adapts internal weights. | Extremely expensive; slow (hours/days latency); risk of catastrophic forgetting. |
| **Single Flat Chat History (Raw Text Storage)** | Simple setup. | Quickly blows token budgets; cannot differentiate between procedural, episodic, and semantic facts. |
| **No Cross-PR Memory** | Zero database storage overhead. | Bot remains permanently naive, repeatedly generating the same dismissed review comments. |

---

## Consequences & Trade-offs
* **Positive:** Continuous learning without model fine-tuning; zero repeated false-positives; mathematically grounded memory prioritization.
* **Negative:** Requires storing episodic records in PostgreSQL; requires reflection background jobs.
