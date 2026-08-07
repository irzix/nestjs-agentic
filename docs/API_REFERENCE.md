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

### ToolExecutionResult

3-variant result returned by tool closures.

```typescript
type ToolExecutionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; status: 'denied'; reason: string }
  | { success: false; status: 'pending_approval'; reason: string; approvalId: string };
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
}

interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
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

## Tokens

| Token | Description |
|---|---|
| `RUNTIME_ADAPTER` | Token for providing custom or built-in `RuntimeAdapter` |
| `SESSION_STORE` | Token for providing custom `SessionStore` |
| `APPROVAL_STORE` | Token for providing custom `ApprovalStore` (default `InMemoryApprovalStore`) |
| `AGENT_OBSERVERS` | Token for providing observers |
