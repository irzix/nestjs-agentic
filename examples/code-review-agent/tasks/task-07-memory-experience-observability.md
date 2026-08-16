# Task 07: Memory Hierarchy, Experience Reflection & OpenTelemetry Observability

> **Implementation specification for 5-Tier Memory, Stanford Tri-Factor Scoring, Reflexion Engine, and OpenTelemetry Audit Sinks.**

---

## 🎯 Objective
Implement the 5-tier memory subsystem, the Stanford memory retrieval scoring engine, the closed-loop maintainer feedback reflection engine, and the enterprise OpenTelemetry semantic audit logging sink.

---

## 📁 Target Files to Create
* `src/memory/stanford-memory-scorer.ts`
* `src/memory/stores/semantic-memory.store.ts`
* `src/memory/stores/episodic-experience.store.ts`
* `src/memory/stores/procedural-playbook.store.ts`
* `src/memory/reflection-engine.service.ts`
* `src/memory/feedback-ingress.service.ts`
* `src/audit/postgres-audit.sink.ts`

---

## 📋 Detailed Technical Requirements

### 1. Stanford Memory Scorer (`src/memory/stanford-memory-scorer.ts`)
* Implement the tri-factor memory ranking formula (*Park et al., Stanford/Google*):
  $$\text{Score}(m) = 0.25 \cdot (0.95^{\text{days}}) + 0.25 \cdot \text{Importance}(m) + 0.50 \cdot \text{CosineSim}(m, q)$$
* Rank and return top 3 episodic records relevant to the current PR diff.

### 2. Multi-Tier Memory Stores (`src/memory/stores/`)
* **`semantic-memory.store.ts`:** Stores architectural invariants and repository coding conventions in PostgreSQL pgvector.
* **`episodic-experience.store.ts`:** Stores past review events, maintainer dismissal explanations, and PR episodes.
* **`procedural-playbook.store.ts`:** Stores deterministic multi-step playbooks (`create_fix_branch`, `run_unit_tests`).

### 3. Reflection Engine (`src/memory/reflection-engine.service.ts`)
* Implement *Reflexion (Shinn et al., MIT)*:
  * Analyze closed PRs and maintainer dismissals (`@njent false-positive`).
  * Synthesize verbal lessons: *"On module X, do not flag pattern Y because Z."*
  * Store lessons in `EpisodicExperienceStore`.

### 4. OpenTelemetry Audit Sink (`src/audit/postgres-audit.sink.ts`)
* Record immutable audit events with CNCF OpenTelemetry GenAI semantic conventions:
  * `trace_id`, `session_id`, `actor`, `tool_name`, `decision`.
  * `gen_ai.system`, `gen_ai.request.model`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `duration_ms`.

---

## ✅ Acceptance Criteria & Testing
1. Stanford memory scorer correctly prioritizes recent high-importance lessons over stale low-importance notes.
2. Maintainer false-positive feedback generates a verbal reflection that successfully prevents repeat warnings.
3. Audit sink accurately records all turn events with OpenTelemetry attributes.
4. Unit tests pass: `npm run test:unit -- src/memory src/audit`
