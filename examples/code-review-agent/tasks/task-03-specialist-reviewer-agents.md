# Task 03: Specialist Reviewer Agents & Supervisor Implementation

> **Implementation specification for Domain-Isolated Specialist Reviewers, Lead ReAct Synthesizer, and Automated Code Fixer.**

---

## 🎯 Objective
Define the modular `@Agent` providers in NestJS representing the specialist reviewers, the lead synthesizing supervisor, and the automated code repair agent, strictly enforcing domain context isolation and ReAct trajectory execution.

---

## 📁 Target Files to Create
* `src/agents/security-reviewer.agent.ts`
* `src/agents/architecture-reviewer.agent.ts`
* `src/agents/quality-reviewer.agent.ts`
* `src/agents/lead-synthesizer.agent.ts`
* `src/agents/code-fixer.agent.ts`
* `src/agents/schemas/review-output.schema.ts`
* `src/agents/formatters/react-trajectory.formatter.ts`

---

## 📋 Detailed Technical Requirements

### 1. Domain Specialist Agents (`@Agent` Providers)
* **`SecurityReviewerAgent`:** Audits for OWASP Top 10 vulnerabilities, unvalidated input, hardcoded credentials, secret leaks, and missing RBAC guards.
* **`ArchitectureReviewerAgent`:** Audits for `nestjs-agentic` architectural rules (dependency injection, policy placement, modular package boundaries, and roadmap compliance).
* **`QualityReviewerAgent`:** Audits for TypeScript strictness, promise error handling, computational complexity ($O(N^2)$ loops), and clean code conventions.

### 2. Lead Synthesizer Supervisor (`src/agents/lead-synthesizer.agent.ts`)
* Implements the supervisor agent using the formal **ReAct Grammar**:
  * `Thought`: Reason over aggregated specialist findings.
  * `Action`: Fetch additional codebase files if needed.
  * `Observation`: Evaluate fetched context.
  * `Final Answer`: Produce a consolidated, actionable Markdown review report.
* Enforces execution limits: `maxTurns: 8`, `maxToolCalls: 12`, `maxDurationMs: 60000`.

### 3. Automated Code Fixer Agent (`src/agents/code-fixer.agent.ts`)
* Activated by `@njent apply-fixes`.
* Analyzes flagged review issues and generates minimal, syntactically valid TypeScript patch diffs.
* Dispatches proposed fixes to the Docker MCP test runner for verification before requesting maintainer approval.

### 4. Structured Output Schemas (`src/agents/schemas/`)
* Define strict Zod validation schemas for structured review outputs (`PRReviewSummarySchema`, `InlineIssueSchema`).

---

## ✅ Acceptance Criteria & Testing
1. Each specialist agent operates within its isolated domain prompt without prompt leakage.
2. `LeadSynthesizerAgent` emits valid ReAct stream events (`thought`, `action_call`, `observation`).
3. Code fixer emits valid unified git diff patches matching target file paths.
4. Unit tests pass: `npm run test:unit -- src/agents`
