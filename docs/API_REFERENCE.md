# API Reference

Complete reference for all public exports from `nestjs-agentic`.

---

## Table of Contents

- [Decorators](#decorators)
  - [@Agent](#agent)
  - [@ToolSet](#toolset)
  - [@Tool](#tool)
  - [@Param](#param)
  - [@Context](#context)
  - [@UsePolicies](#usepolicies)
- [Interfaces & Types](#interfaces--types)
  - [AgentProvider](#agentprovider)
  - [AgentConfig](#agentconfig)
  - [AgentContext](#agentcontext)
  - [AgentSecurityContext](#agentsecuritycontext)
  - [ToolPolicy](#toolpolicy)
  - [PolicyResult](#policyresult)
  - [PendingApproval](#pendingapproval)
  - [ApprovalStore](#approvalstore)
  - [ToolProvider](#toolprovider)
  - [ResolvedTool](#resolvedtool)
  - [ToolExecutionInput](#toolexecutioninput)
  - [ToolExecutionResult](#toolexecutionresult)
  - [RuntimeAdapter](#runtimeadapter)
  - [AgentResult](#agentresult)
  - [AgentObserver](#agentobserver)
- [Services](#services)
  - [AgentRunner](#agentrunner)
  - [ApprovalService](#approvalservice)
  - [AgenticModule](#agenticmodule)
- [Testing](#testing)
  - [MockRuntimeAdapter](#mockruntimeadapter)
- [Tokens](#tokens)

---

## Decorators

### @Agent

Marks a class as an agent provider.

```typescript
@Agent(options: AgentDecoratorOptions)
```

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Unique agent identifier used in `AgentRunner.run(name)`. |
| `description` | `string` | ✅ | Human-readable description passed to the LLM. |
| `model` | `ModelConfig` | ❌ | Model configuration (`{ provider, model }`). Defaults to `defaultModel` from `forRoot()`. |

---

### @ToolSet

Marks a NestJS provider class as a container for related tools.

```typescript
@ToolSet(options: ToolSetDecoratorOptions)
```

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Domain name for this tool group. |
| `description` | `string` | ❌ | Description of this tool domain. |
| `tags` | `string[]` | ❌ | Descriptive metadata tags for discovery and documentation. |

---

### @Tool

Marks a method inside a `@ToolSet` class as callable by an LLM.

```typescript
@Tool(options: ToolDecoratorOptions)
```

---

### @Param

Declares a parameter on a `@Tool` method.

```typescript
@Param(name: string, options?: ParamDecoratorOptions)
```

---

### @Context

Injects the current `AgentContext` into a tool method parameter (not exposed to the LLM).

---

### @UsePolicies

Attaches one or more policies to a tool method or an entire `@ToolSet` class.

---

## Interfaces & Types

### AgentContext

Context object injected into tool handlers via `@Context()`. Never sent to the LLM.

```typescript
interface AgentSecurityContext {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  permissions?: string[];
}

interface AgentContext {
  security: AgentSecurityContext;
  sessionId: string;
  traceId: string;          // auto-generated UUID per run
  data?: Record<string, unknown>;
}
```

---

### AgentProvider & AgentConfig

```typescript
interface AgentConfig {
  instructions: string;
  tools: object[];           // @ToolSet instances
  subAgents?: AgentProvider[]; // @future v0.2 multi-agent
  model?: ModelConfig;       // overrides forRoot() defaultModel
}

interface AgentProvider {
  define(): AgentConfig;
}
```

---

### ToolPolicy & PolicyResult

3-state policy decision supporting Human-in-the-Loop (HITL) approval requirements.

```typescript
interface ToolPolicy {
  evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult>;
}

type PolicyResult =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'require_approval'; reason: string };
```

### ToolExecutionInput & ToolExecutionResult

`ToolExecutionInput` only carries `args` — `AgentContext` is pre-bound inside the
tool closure by `LocalToolProvider` and is never exposed to the adapter or the LLM.

```typescript
interface ToolExecutionInput {
  args: Record<string, unknown>;
}

type ToolExecutionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; status: 'denied'; reason: string }
  | { success: false; status: 'pending_approval'; reason: string; approvalId: string };
```

### ResolvedTool & ToolProvider

```typescript
interface ToolParamSchema {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}

interface ResolvedTool {
  name: string;
  description: string;
  parameters: ToolParamSchema[];
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

interface ToolProvider {
  getTools(): ResolvedTool[];
}
```

### RuntimeAdapter & AgentResult

```typescript
interface ModelConfig {
  provider: 'google' | 'openai' | 'anthropic' | string;
  model: string;
}

interface AgentRunInput {
  sessionId: string;
  message: string;
  tools: ResolvedTool[];
  model: ModelConfig;
  instructions?: string;
}

interface AgentResult {
  sessionId: string;
  output: string;
  toolCalls: ToolCallRecord[];
}

interface RuntimeAdapter {
  execute(input: AgentRunInput): Promise<AgentResult>;
  stream?(input: AgentRunInput): AsyncIterable<string>; // optional
}
```

### PendingApproval & ApprovalStore

```typescript
interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  /** Tool closure invoked on approval — stored internally by LocalToolProvider. */
  execute: () => Promise<unknown>;
}

interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
}
```

### AgentObserver

All methods are optional — implement only what you need.

```typescript
interface AgentObserver {
  onAgentStart?(agentName: string, sessionId: string): void;
  onAgentEnd?(agentName: string, result: AgentResult): void;
  onToolCall?(toolName: string, args: Record<string, unknown>): void;
  onToolResult?(toolName: string, result: unknown, durationMs: number): void;
  onError?(agentName: string, error: Error): void;
}
```

---

## Services

### ApprovalService

Injectable service to execute pending HITL tool requests.

```typescript
@Injectable()
export class ApprovalService {
  /**
   * Executes the pending tool call with stored args & context.
   */
  async approve(approvalId: string): Promise<ToolExecutionResult>;

  /**
   * Rejects and removes a pending approval request.
   */
  async reject(approvalId: string, reason?: string): Promise<void>;
}
```

---

## Default Store Implementations

Two in-memory stores are provided out of the box. They are used automatically
by `AgenticModule` unless overridden with a custom provider.

| Class | Token to override | Notes |
|---|---|---|
| `InMemoryApprovalStore` | `APPROVAL_STORE` | Not suitable for multi-instance deployments |
| `InMemorySessionStore` | `SESSION_STORE` | Not suitable for multi-instance deployments |

To plug in Redis or any other backend:

```typescript
{ provide: APPROVAL_STORE, useClass: RedisApprovalStore }
{ provide: SESSION_STORE, useClass: RedisSessionStore }
```

---

## Tokens

| Token | Description |
|---|---|
| `RUNTIME_ADAPTER` | Token for providing custom or built-in `RuntimeAdapter` |
| `APPROVAL_STORE` | Token for providing custom `ApprovalStore` (default: `InMemoryApprovalStore`) |
| `SESSION_STORE` | Token for providing custom `SessionStore` (default: `InMemorySessionStore`) |
| `AGENT_OBSERVERS` | Multi-provider token for `AgentObserver` implementations |
| `POLICY_INSTANCES` | Internal — populated by `forFeature({ policies: [] })` |
| `AGENT_PROVIDERS` | Internal — populated by `forFeature({ agents: [] })` |
| `AGENTIC_OPTIONS` | Internal — populated by `forRoot()` |
