# Core API Reference

This document describes the public API exported by `@nestjs-agentic/core` and re-exported by the `nestjs-agentic` meta-package in the `0.4.x` release line.

Runtime-specific, memory, RAG, orchestration, experience, and evaluation APIs are documented by their own packages. Experimental behavior and planned contracts are identified explicitly below.

## Decorators

### `@Agent(options)`

Marks an `AgentProvider` class and applies NestJS `@Injectable()`.

```typescript
interface AgentDecoratorOptions {
  name: string;
  description: string;
  model?: ModelConfig;
}
```

- `name` is the identifier passed to `AgentRunner.run()` and `runStream()`.
- `model` overrides the root `defaultModel` for this agent.

### `@ToolSet(options)`

Marks a class as a NestJS provider containing model-callable tools and applies `@Injectable()`.

```typescript
interface ToolSetOptions {
  name: string;
  description?: string;
  tags?: string[];
}
```

### `@Tool(options)`

Marks a method inside a tool set as callable through a resolved, policy-guarded closure.

```typescript
interface ToolOptions {
  description: string;
  name?: string; // defaults to the method name
}
```

### `@Param(name, options?)`

Exposes a method parameter in the tool input schema.

```typescript
interface ParamOptions {
  description?: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}
```

### `@Context()`

Injects the current `AgentContext` into a tool method parameter. This parameter is not included in the tool schema passed to the runtime.

### `@UsePolicies(...policies)`

Attaches `ToolPolicy` classes to a tool method or tool-set class. Register each policy class through `AgenticModule.forFeature({ policies: [...] })`.

## Agent Contracts

```typescript
interface ModelConfig {
  provider: 'google' | 'openai' | 'anthropic' | (string & {});
  model: string;
}

interface AgentConfig {
  instructions: string;
  tools: object[];
  subAgents?: AgentProvider[];
  model?: ModelConfig;
}

interface AgentProvider {
  define(): AgentConfig;
}
```

`AgentConfig.subAgents` is present in the public type but is not automatically converted to tools or executed by `AgentRunner` in `0.4.x`. Use the experimental `@nestjs-agentic/orchestration` package explicitly for current delegation APIs.

## Agent Context

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
  traceId: string;
  data?: Record<string, unknown>;
}
```

`AgentRunner` generates a new `traceId` for each run. `LocalToolProvider` binds this context to resolved tool closures so runtimes do not receive security fields as model-authored tool arguments.

## Tool Contracts

```typescript
interface ToolParamSchema {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}

interface ToolExecutionInput {
  args: Record<string, unknown>;
}

type ToolExecutionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; status: 'denied'; reason: string }
  | {
      success: false;
      status: 'pending_approval';
      reason: string;
      approvalId: string;
    };

interface ResolvedTool {
  name: string;
  description: string;
  parameters: ToolParamSchema[];
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

interface ToolProvider {
  getTools(): ResolvedTool[];
}

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}
```

A compliant runtime calls `ResolvedTool.execute()` and does not invoke application providers directly. Policy and approval behavior is contained inside that closure.

## Policy Contracts

```typescript
type PolicyResult =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'require_approval'; reason: string };

interface ToolPolicy {
  evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult>;
}
```

Policies execute in declaration order. A deny or approval decision stops execution before the application tool method is called.

## Runtime Contracts

```typescript
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
  stream?(input: AgentRunInput): AsyncIterable<AgentStreamEvent>;
}
```

The `0.4.x` runtime contract does not yet standardize cancellation, model messages, usage, checkpoints, or provider errors. Runtime adapters are responsible for their own model behavior until the independent runtime contracts described in the roadmap are introduced.

### Stream Events

```typescript
type AgentStreamEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool_start';
      id?: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      id?: string;
      toolName: string;
      result: ToolExecutionResult;
    }
  | {
      type: 'approval_required';
      id?: string;
      toolName: string;
      approvalId: string;
      reason: string;
    }
  | { type: 'complete'; sessionId: string; output: string };
```

These event types are public. Ordering and token behavior currently depend on the selected adapter.

## `AgentRunner`

```typescript
interface RunInput {
  sessionId: string;
  message: string;
  context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
    data?: Record<string, unknown>;
  };
}

class AgentRunner {
  run(agentName: string, input: RunInput): Promise<AgentResult>;
  runStream(
    agentName: string,
    input: RunInput,
  ): AsyncIterable<AgentStreamEvent>;
}
```

`run()` resolves the registered agent, creates context, resolves governed tools, and delegates to `RuntimeAdapter.execute()`.

`runStream()` delegates to `RuntimeAdapter.stream()` when available. Otherwise, it converts a completed `AgentResult` into tool, token, and completion events.

## Approval API

```typescript
interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  execute: () => Promise<unknown>;
}

interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
}

class ApprovalService {
  approve(approvalId: string): Promise<ToolExecutionResult>;
  reject(approvalId: string): Promise<void>;
}
```

`approve()` invokes the stored closure and then removes the record. In `0.4.x`, the closure is process-local and cannot be reconstructed after a restart. The API protects individual tool invocations; it does not resume the original model turn.

## Module Configuration

```typescript
interface AgenticModuleOptions {
  defaultModel: ModelConfig;
  stateStore?: StateStore;
}

interface ForFeatureOptions {
  agents?: Type<AgentProvider>[];
  toolSets?: Type<object>[];
  policies?: Type<ToolPolicy>[];
}

class AgenticModule {
  static forRoot(options: AgenticModuleOptions): DynamicModule;
  static forFeature(options: ForFeatureOptions): DynamicModule;
}
```

Call `forRoot()` once to register core services and defaults. Call `forFeature()` in feature modules to register agents, tool sets, and policies.

```typescript
AgenticModule.forRoot({
  defaultModel: { provider: 'mock', model: 'deterministic' },
});

AgenticModule.forFeature({
  agents: [SupportAgent],
  toolSets: [OrderTools],
  policies: [RefundLimitPolicy],
});
```

A `RUNTIME_ADAPTER` provider is required by `AgentRunner` and must be registered by the application.

## Session and State Stores

```typescript
interface SessionStore {
  get(sessionId: string): Promise<unknown | null>;
  set(sessionId: string, data: unknown): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

interface StateStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(prefix?: string): Promise<void>;
}
```

Exported implementations:

| Class | Purpose |
| --- | --- |
| `InMemoryApprovalStore` | Default approval store; process-local. |
| `InMemorySessionStore` | Default session store; process-local. |
| `InMemoryStateStore` | Default `STATE_STORE`; process-local. |
| `RedisStateStore` | JSON-serializing `StateStore` using a compatible Redis client. |

```typescript
const stateStore = new RedisStateStore({
  client: redisClient,
  keyPrefix: 'agentic:state:',
});

AgenticModule.forRoot({
  defaultModel: { provider: 'mock', model: 'deterministic' },
  stateStore,
});
```

Registering a `StateStore` does not automatically persist `AgentRunner` executions in `0.4.x`.

## Built-in Policies

### `RateLimitPolicy`

```typescript
new RateLimitPolicy({ maxCallsPerMinute: 5 });
```

The implementation uses a process-local sliding window keyed by tenant, user, and tool. Use distributed application infrastructure when limits must be shared across instances.

### `CostLimitPolicy`

```typescript
new CostLimitPolicy({
  paramName: 'amount',       // default: 'amount'
  autoAllowLimit: 500,       // default: 1000
  approvalLimit: 5_000,      // default: 10000
});
```

Values at or below `autoAllowLimit` are allowed, values through `approvalLimit` require approval, and larger values are denied.

### `LoggingPolicy`

```typescript
new LoggingPolicy({
  logLevel: 'debug',
  includeArgs: true,
  includeContext: true,
  sensitiveFields: ['password', 'apiKey'],
  logger: (message, data) => applicationLogger.debug(message, data),
});
```

This policy logs the attempted invocation and always returns `allow`. It is not a persistent audit store.

## `MockRuntimeAdapter`

```typescript
const runtime = new MockRuntimeAdapter();

runtime
  .whenAsked('Refund order 42')
  .thenCallTool('refundOrder', { orderId: '42', amount: 600 });

runtime.reset();
```

Configured messages invoke the selected resolved tool. Unconfigured messages return a deterministic mock response. The adapter also emits structured stream events.

## Observer Contract

```typescript
interface AgentObserver {
  onAgentStart?(agentName: string, sessionId: string): void;
  onAgentEnd?(agentName: string, result: AgentResult): void;
  onToolCall?(toolName: string, args: Record<string, unknown>): void;
  onToolResult?(toolName: string, result: unknown, durationMs: number): void;
  onError?(agentName: string, error: Error): void;
}
```

`AgentObserver` and `AGENT_OBSERVERS` are exported extension contracts, but `AgentRunner` does not dispatch these hooks in `0.4.x`. End-to-end observer wiring is planned.

## Injection Tokens

| Token | Purpose | Current behavior |
| --- | --- | --- |
| `RUNTIME_ADAPTER` | Selected runtime implementation | Required application provider. |
| `APPROVAL_STORE` | `ApprovalStore` implementation | Defaults to `InMemoryApprovalStore`. |
| `SESSION_STORE` | `SessionStore` implementation | Defaults to `InMemorySessionStore`. |
| `STATE_STORE` | `StateStore` implementation | Defaults to `InMemoryStateStore`. |
| `AGENT_OBSERVERS` | Observer multi-provider contract | Exported but not dispatched by `AgentRunner` in `0.4.x`. |

Other exported constants primarily support framework metadata and internal provider discovery and should not be treated as stable application extension points before 1.0.
