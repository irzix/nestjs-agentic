# Detailed Sequence Diagrams for Njent

> **Comprehensive Mermaid sequence diagrams detailing multi-agent interactions, RAG retrieval, quality gates, and governed human-in-the-loop executions.**

---

## 1. Full PR Review Flow (`@njent review`)

```mermaid
sequenceDiagram
    autonumber
    actor Maintainer as 👨‍💻 Maintainer / Collaborator
    participant GitHub as 🐙 GitHub Webhook
    participant WebhookCtrl as 🚪 WebhookController
    participant Guards as 🛡️ Auth & RateLimit Guards
    participant Pruner as ✂️ ContextPruner
    participant RAG as 🌳 AST Hybrid RAG Pipeline
    participant Orch as 👥 PrReviewOrchestrator
    participant ParallelRunner as ⚡ ParallelSubAgentRunner
    participant SecurityAgent as 🛡️ SecurityReviewer
    participant ArchAgent as 🏛️ ArchitectureReviewer
    participant QualityAgent as ⚡ QualityReviewer
    participant Synthesizer as 🧠 LeadSynthesizer (ReAct)
    participant Judge as ⚖️ ReviewQualityEvaluator
    participant Octokit as 🐙 GitHub Octokit Tool
    participant Audit as 📊 PostgresAudit & Experience

    Maintainer->>GitHub: Post comment: "@njent review"
    GitHub->>WebhookCtrl: POST /webhooks/github (HMAC Signature)
    WebhookCtrl->>Guards: Validate HMAC-SHA256 & Collaborator RBAC
    Guards-->>WebhookCtrl: Authorized (Role: write/admin)
    WebhookCtrl-->>GitHub: 202 Accepted (Fast Ingress)

    WebhookCtrl->>Pruner: Fetch and Prune Git Diff (Strip lockfiles/assets)
    Pruner-->>WebhookCtrl: Sanitized Diff Context

    WebhookCtrl->>RAG: Execute Hybrid AST Search (Dense HNSW + BM25 RRF)
    RAG-->>WebhookCtrl: Relevant Type Signatures & Guidelines

    WebhookCtrl->>Orch: runReview(sessionId, ctx, prunedDiff, ragContext)
    Orch->>ParallelRunner: Fan-out 3 Specialist Tasks (maxConcurrency: 3)

    par Parallel Specialist Analysis
        ParallelRunner->>SecurityAgent: Audit vulnerabilities & secrets
        SecurityAgent-->>ParallelRunner: Security Findings
    and
        ParallelRunner->>ArchAgent: Audit DI, roadmap & package modularity
        ArchAgent-->>ParallelRunner: Architecture Findings
    and
        ParallelRunner->>QualityAgent: Audit complexity & TypeScript types
        QualityAgent-->>ParallelRunner: Quality Findings
    end

    ParallelRunner-->>Orch: Aggregated Specialist Findings (Consensus Score: 0.92)
    Orch->>Synthesizer: ReAct Reasoning Loop (Synthesize unified review)
    Synthesizer-->>Orch: Drafted Markdown Review Report

    Orch->>Judge: evaluateWithDebias(diff, draftedReview)
    Judge-->>Orch: Passed (Score: 0.94, Line references valid)

    Orch->>Octokit: post_pr_review_comment(prNumber, reportMarkdown)
    Octokit->>GitHub: Publish Verified Review on Pull Request
    GitHub-->>Maintainer: Review Visible on PR

    Orch->>Audit: Record Audit Trace (Tokens, Latency) & Episodic Experience
```

---

## 2. Automated Code Fix Flow & Human Approval Settlement (`@njent apply-fixes`)

```mermaid
sequenceDiagram
    autonumber
    actor Maintainer as 👨‍💻 Maintainer / Collaborator
    participant GitHub as 🐙 GitHub Webhook
    participant WebhookCtrl as 🚪 WebhookController
    participant FixerAgent as 🛠️ CodeFixerAgent
    participant McpSandbox as 🐳 Docker MCP Test Sandbox
    participant PolicyEngine as 🛡️ Policy Engine (@UsePolicies)
    participant RedisStore as 🔴 RedisApprovalStore
    participant SettleApi as 🌐 Approval Settlement API

    Maintainer->>GitHub: Post comment: "@njent apply-fixes"
    GitHub->>WebhookCtrl: POST /webhooks/github (HMAC Signature)
    WebhookCtrl->>FixerAgent: executeFixPlan(prDiff, issuesList)

    loop Self-Correction Verification Loop (Max 2 iterations)
        FixerAgent->>FixerAgent: Generate Patch in Memory
        FixerAgent->>McpSandbox: execute_sandboxed_command("npm run test:related")
        McpSandbox-->>FixerAgent: Test Results (0 Errors, All Passed)
    end

    FixerAgent->>PolicyEngine: Invoke Tool: git_create_branch_and_commit
    PolicyEngine->>PolicyEngine: Evaluate RequireMaintainerApprovalPolicy
    PolicyEngine-->>FixerAgent: Decision: "require_approval" (Suspension Triggered)

    FixerAgent->>RedisStore: Save Versioned ApprovalCheckpoint (TTL: 86400s)
    FixerAgent->>GitHub: Post PR Comment: "Fix generated & verified. Click [Approve Fix] to apply."
    FixerAgent-->>WebhookCtrl: Turn Suspended (Memory Freed)

    Note over Maintainer,SettleApi: Hours later, Maintainer reviews diff and approves
    Maintainer->>SettleApi: POST /approvals/chk_789/settle { decision: "approved" }
    SettleApi->>RedisStore: Claim & Settle Checkpoint (Atomic NX)
    SettleApi->>FixerAgent: resumeTurn(checkpoint)
    
    FixerAgent->>GitHub: Create Branch "njent/fix-pr-42" & Push Verified Commits
    GitHub-->>Maintainer: Fix PR / Commits Ready for Merge
```
