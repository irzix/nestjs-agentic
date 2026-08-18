# @nestjs-agentic/mcp

Official **Model Context Protocol (MCP)** client transport, dynamic tool provider, and secure execution runtime for `nestjs-agentic`.

---

## 📚 Academic & Industry Foundations

- **Model Context Protocol Specification (2024-11-05)**: [modelcontextprotocol.io](https://modelcontextprotocol.io) — Anthropic open standard for secure LLM tool connectivity.
- **Toolformer: Language Models Can Teach Themselves to Use Tools**: *Schick et al., Meta AI Research (NeurIPS 2023)* ([arXiv:2302.04761](https://arxiv.org/abs/2302.04761)).
- **Gorilla: Large Language Model Connected with Massive APIs**: *Patil et al., UC Berkeley (NeurIPS 2023)* ([arXiv:2305.15334](https://arxiv.org/abs/2305.15334)) — Deterministic parameter pre-validation.
- **ToolBench / AnyTool: Dynamic Tool Discovery**: *Qin et al. (ICLR 2024)* ([arXiv:2307.16789](https://arxiv.org/abs/2307.16789)) — Dynamic tool discovery and runtime server synchronization.
- **OWASP Top 10 for LLM Applications (2025)**: LLM07 (Excessive Agency & Sandboxed Execution) and LLM02 (Sensitive Information Disclosure).

---

## Features

- **Sandboxed Subprocess Transport (`StdioClientTransport`)**: Connects to local CLI tools, Docker containers, and Python/Rust MCP servers over standard I/O streams with process lifecycle supervision.
- **Remote SSE Transport (`SseClientTransport`)**: Connects to remote MCP servers over HTTP Server-Sent Events with HTTP POST request dispatch and authentication headers.
- **Dynamic Tool Discovery & Hot-Reloading**: Automatically discovers server tools via `tools/list` and reacts to `notifications/tools/list_changed` events without application restarts.
- **Deterministic Pre-conditions (Gorilla AST Validation)**: Validates input arguments against JSON Schema before network dispatch to eliminate parameter hallucinations.
- **In-flight Cancellation Propagation**: Seamlessly maps `AbortSignal` to JSON-RPC `notifications/cancelled` notifications.
- **Full Governance & Policy Integration**: Attaches NestJS `@UsePolicies` (RBAC, Rate Limiting, Tenant Isolation, Approval Workflows) directly to MCP tools.
- **OWASP Security Hardening**: Sanitizes `stderr` and error payloads to prevent accidental credential leakage (`Bearer`, `api_key`, `token`).

---

## Installation

```bash
npm install @nestjs-agentic/mcp @nestjs-agentic/core
```

---

## Quick Start

### 1. Register MCP Servers in NestJS

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpService } from '@nestjs-agentic/mcp';

export const FILESYSTEM_TOOLS = Symbol('FILESYSTEM_TOOLS');

@Module({
  imports: [
    McpModule.register({
      servers: [
        {
          name: 'filesystem',
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/workspace'],
          },
          timeoutMs: 30000,
        }
      ],
    }),
  ],
  providers: [
    // Expose the dynamic MCP tool provider as a standard DI token
    {
      provide: FILESYSTEM_TOOLS,
      useFactory: (mcpService: McpService) => mcpService.getProvider('filesystem'),
      inject: [McpService],
    },
  ],
  exports: [FILESYSTEM_TOOLS],
})
export class AppModule {}
```

### 2. Inject and Use MCP Tools in an Agent

Since `@nestjs-agentic/mcp` natively implements the `ToolProvider` interface, it can be seamlessly injected into any agent definition.

```typescript
import { Injectable } from '@nestjs/common';
import { Agent, AgentRunner, AgentContext } from '@nestjs-agentic/core';
import { FILESYSTEM_TOOLS } from './app.module';

@Agent({
  name: 'reviewer',
  instructions: 'You are a code reviewer.',
  tools: [FILESYSTEM_TOOLS], // MCP tools are automatically resolved and injected!
})
@Injectable()
export class CodeReviewAgent {
  constructor(private readonly runner: AgentRunner) {}

  async review(context: AgentContext, prNumber: number) {
    return this.runner.run('reviewer', {
      sessionId: `pr-review-${prNumber}`,
      context,
      message: `Review PR #${prNumber} by inspecting modified files.`,
    });
  }
}
```

---

## Standalone Client Usage

```typescript
import { McpClient, StdioClientTransport } from '@nestjs-agentic/mcp';

const transport = new StdioClientTransport({
  serverName: 'python-tools',
  command: 'python',
  args: ['-m', 'my_mcp_server'],
});

const client = new McpClient({
  serverName: 'python-tools',
  transport,
});

await client.connect();

// List tools
const tools = await client.listTools();

// Execute a tool
const result = await client.callTool('run_linter', {
  filePath: 'src/main.ts',
});

console.log(result.content);
await client.close();
```

---

## License

MIT
