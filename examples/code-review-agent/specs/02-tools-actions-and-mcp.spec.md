# 02 — Tools, Actions & MCP Specification
> **Comprehensive specification of Native Tools, Model Context Protocol (MCP), Deterministic Pre-conditions, and Structured Output in Njent.**

---

## 📚 Academic & Research Foundations
* **Toolformer: Language Models Can Teach Themselves to Use Tools** — *Schick et al., Meta AI Research (2023)* ([arXiv:2302.04761](https://arxiv.org/abs/2302.04761)).
* **Model Context Protocol (MCP) Specification** — *Anthropic (2024)* ([modelcontextprotocol.io](https://modelcontextprotocol.io)).

---

## 1. Concrete Mapping of All 5 Tool Concepts in Njent

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NJENT TOOLING SYSTEM                                 │
├───────────────────────────┬────────────────────────────────────────────────────────────┤
│ 1. How Tool Calling Works │ • Model emits JSON Schema arguments ➔ Runtime executes ➔   │
│                           │   Output returned to model reasoning loop                  │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 2. What is MCP & How it   │ • JSON-RPC standard protocol connecting LLM to isolated    │
│    Works                  │   subprocesses/remote servers via stdio / SSE transport    │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 3. Native Tools vs. MCP   │ • Native (@Tool): Fast, in-process NestJS services         │
│                           │ • MCP Client: Sandboxed CI test runners & external tools   │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 4. Deterministic          │ • Pre-conditions: Param validation, RBAC checks, TTL check │
│    Conditions             │ • Post-conditions: Output schema check, Secret redaction   │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 5. Structured Output      │ • Strict Zod / TypeScript JSON Schema output enforcement   │
└───────────────────────────┴────────────────────────────────────────────────────────────┘
```

---

## 2. Technical Specification & Implementation Details

### 2.1 Native Governed Tools (`@Tool`, `@Param`, `@Context`)
In-process tools executed directly within the NestJS dependency injection container:
```typescript
import { Injectable } from '@nestjs/common';
import { Tool, Param, Context, AgentContext, UsePolicies } from '@nestjs-agentic/core';
import { OctokitService } from '../services/octokit.service';
import { RequireCollaboratorPolicy } from '../policies/collaborator.policy';

@Injectable()
export class GitHubPRTools {
  constructor(private readonly octokit: OctokitService) {}

  @Tool({
    name: 'fetch_pr_diff',
    description: 'Fetches the unified git diff for the current pull request.',
  })
  @UsePolicies(RequireCollaboratorPolicy)
  async fetchDiff(@Context() ctx: AgentContext): Promise<string> {
    return this.octokit.getDiff(ctx.metadata.repo, ctx.metadata.prNumber);
  }

  @Tool({
    name: 'post_inline_review_comment',
    description: 'Publishes a structured review comment on an exact line in the PR diff.',
  })
  @UsePolicies(RequireCollaboratorPolicy)
  async postComment(
    @Param({ name: 'path', type: 'string', description: 'Target file path', required: true }) path: string,
    @Param({ name: 'line', type: 'number', description: 'Line number in diff', required: true }) line: number,
    @Param({ name: 'body', type: 'string', description: 'Markdown comment content', required: true }) body: string,
    @Context() ctx: AgentContext,
  ) {
    return this.octokit.createInlineComment(ctx.metadata.repo, ctx.metadata.prNumber, { path, line, body });
  }
}
```

---

### 2.2 Model Context Protocol (MCP) Client Provider (`McpSandboxClient`)
Used when executing isolated external sandboxes (e.g. running tests in a Docker container via MCP):
```typescript
import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

@Injectable()
export class SandboxMcpToolProvider {
  private mcpClient: Client;

  async onModuleInit() {
    // Connects to isolated MCP server running the CI sandbox
    const transport = new StdioClientTransport({
      command: 'docker',
      args: ['run', '-i', '--rm', 'njent-test-sandbox-mcp'],
    });
    this.mcpClient = new Client({ name: 'njent-core', version: '1.0.0' }, { capabilities: {} });
    await this.mcpClient.connect(transport);
  }

  async runSandboxedCommand(command: string) {
    return this.mcpClient.callTool({
      name: 'execute_sandboxed_command',
      arguments: { command },
    });
  }
}
```

---

### 2.3 Deterministic Pre- & Post-Conditions
Before invoking any tool:
```typescript
export class DeterministicToolGuard {
  static evaluatePreconditions(schema: ModelToolSchema, args: Record<string, any>, ctx: AgentContext): void {
    // 1. Deterministic RBAC validation
    if (!['admin', 'write', 'maintain'].includes(ctx.metadata.collaboratorRole)) {
      throw new SecurityException('Deterministic Guard: Unauthorized execution attempt.');
    }
    // 2. Deterministic Argument Schema validation
    validateToolArgs(schema, args);
  }

  static evaluatePostconditions(result: any): any {
    // 3. Deterministic Secret & Credential Redaction on tool output
    return SecretRedactor.redact(result);
  }
}
```

---

### 2.4 Structured Output Schema Definition (JSON Schema / Zod)
Guarantees that sub-agents emit strictly typed JSON payloads for review summaries:
```typescript
import { z } from 'zod';

export const PRReviewSummarySchema = z.object({
  overallStatus: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  confidenceScore: z.number().min(0).max(1),
  summaryChecklist: z.array(z.string()),
  inlineIssues: z.array(
    z.object({
      filePath: z.string(),
      lineNumber: z.number().int().positive(),
      category: z.enum(['SECURITY', 'ARCHITECTURE', 'PERFORMANCE', 'CLEAN_CODE']),
      severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      commentMarkdown: z.string(),
      suggestedPatch: z.string().optional(),
    })
  ),
});

export type PRReviewSummary = z.infer<typeof PRReviewSummarySchema>;
```

---

## 3. Tool Architecture Trade-offs

| Tool Architecture | Execution Latency | Security & Isolation | Dependency Injection | Best Fit in Njent |
|---|---|---|---|---|
| **Native NestJS `@Tool`** | < 1ms (In-memory) | In-process boundary | Full NestJS DI access | Core GitHub APIs, RAG, & DB. |
| **Model Context Protocol (MCP)** | ~15–30ms (IPC / Docker) | Strong containerized sandbox | Isolated process | Untrusted code execution & CI tests. |
