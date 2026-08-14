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

## Model Contracts

Registering a `ModelAdapter` activates the built-in agent runtime.

```typescript
const MODEL_ADAPTER: symbol;

interface ModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

interface ModelRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: ModelToolSchema[];
  signal?: AbortSignal;
  metadata: {
    sessionId: string;
    traceId: string;
    executionId: string;
    iteration: number;
  };
}

interface ModelResponse {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';
}

type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ModelToolSchema {
  name: string;
  description: string;
  parameters: ToolParamSchema[];
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

type ModelStreamChunk =
  | { type: 'token'; text: string }
  | { type: 'response'; response: ModelResponse };
```

A `ModelAdapter` is responsible only for provider communication. It must not execute tools, evaluate policies, or drive the loop. Implementations of `stream()` must finish by yielding a `response` chunk containing the complete round.

## Execution Budgets

```typescript
interface ExecutionLimits {
  maxIterations?: number; // default 10
  maxToolCalls?: number; // default 32
  timeoutMs?: number; // unlimited when omitted
  maxTotalTokens?: number; // unlimited when omitted
}
```

Limits resolve per run with the precedence: `RunInput.limits`, then `AgentConfig.limits`, then `AgenticModuleOptions.limits`, then framework defaults.

## `AgentExecutor`

```typescript
interface AgentExecutionInput {
  sessionId: string;
  message: string;
  model: ModelConfig;
  tools: ResolvedTool[];
  instructions?: string;
  traceId?: string;
  history?: ModelMessage[];
  limits?: ExecutionLimits;
  signal?: AbortSignal;
}

interface AgentResumeInput {
  sessionId: string;
  model: ModelConfig;
  tools: ResolvedTool[];
  traceId?: string;
  instructions?: string;
  history: ModelMessage[]; // full transcript, including the withheld tool message
  toolCallId: string;      // identifies which withheld message to resolve
  toolName: string;
  args: Record<string, unknown>;
  outcome: ToolExecutionResult; // the resolved approve/deny outcome
  limits?: ExecutionLimits;
  signal?: AbortSignal;
}

class AgentExecutor {
  isAvailable(): boolean;
  execute(input: AgentExecutionInput): Promise<AgentResult>;
  stream(input: AgentExecutionInput): AsyncIterable<AgentStreamEvent>;
  resume(input: AgentResumeInput): Promise<AgentResult>;
  resumeStream(input: AgentResumeInput): AsyncIterable<AgentStreamEvent>;
}
```

`AgentExecutor` is registered by `AgenticModule.forRoot()`. `AgentRunner` uses it automatically, so most applications do not call it directly.

`resume()` and `resumeStream()` continue a turn that suspended on `require_approval`. They splice `outcome` into the tool message identified by `toolCallId` within `history`, then run the model-to-tool loop exactly as `execute()`/`stream()` would, starting from that point. `AgentRunner.settleApproval()` — used internally by `ApprovalService` — calls these when a resolved approval's `PendingApproval.toolCallId` is set.

Loop behavior per round:

1. Send instructions, history, and the user message to the model.
2. If no tool calls are returned, finish with the model content.
3. Validate each requested call against the tool's declared parameters. Undeclared keys are dropped, and invalid calls are reported to the model without invoking the application method.
4. Execute valid calls through `ResolvedTool.execute()`, which applies policies.
5. Stop the turn when a policy returns `require_approval`, surfacing the `approvalId`.
6. Append tool results and continue until a final answer or an exhausted budget.

## Tool Failures

```typescript
type ToolErrorHandling = 'report' | 'throw'; // default: 'report'
```

When an application tool throws, the runtime reports the failure to the model and continues the turn, mirroring how invalid arguments are handled. The model receives a tool message shaped as:

```json
{ "success": false, "status": "error", "error": "Order 99 not found in ledger" }
```

The same payload is recorded on `AgentResult.toolCalls`, and `runStream()` emits a `tool_error` event so a stream never leaves a `tool_start` without a terminal event.

Only the error message is forwarded, truncated to 500 characters. Stack traces are never sent to the model or written into the transcript.

Set `toolErrorHandling: 'throw'` to end the run instead, resolved per run with the precedence: `RunInput`, then `AgentConfig`, then `AgenticModuleOptions`, then the default.

Framework errors are always fatal regardless of this setting, because they signal misconfiguration rather than a recoverable tool failure. Cancellation observed during a tool invocation is reported as `ExecutionCancelledError`.

## Errors

```typescript
class AgenticError extends Error {}
class ToolValidationError extends AgenticError {
  toolName: string;
  issues: string[];
}
class PolicyNotRegisteredError extends AgenticError {
  policyName: string;
}
class ExecutionLimitExceededError extends AgenticError {
  kind: 'max_iterations' | 'max_tool_calls' | 'timeout' | 'max_total_tokens';
  limit: number;
}
class ExecutionCancelledError extends AgenticError {}
class RuntimeNotConfiguredError extends AgenticError {}
class ApprovalNotFoundError extends AgenticError {
  approvalId: string;
}
class ApprovalToolNotFoundError extends AgenticError {
  toolName: string;
}
class ApprovalTranscriptMissingError extends AgenticError {
  toolCallId: string;
}
```

`ToolValidationError` is reported back to the model rather than thrown. Budget, cancellation, and configuration errors are thrown to the caller.

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

`RuntimeAdapter` remains supported for applications that delegate an entire turn to an external runtime. It does not standardize cancellation, model messages, usage, or checkpoints, so such adapters own their behavior. Prefer `ModelAdapter` with the built-in runtime for new applications.

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
  | { type: 'tool_error'; id?: string; toolName: string; error: string }
  | { type: 'complete'; sessionId: string; output: string };
```

These event types are public. With the built-in runtime each tool call ends in exactly one of `tool_result`, `approval_required`, or `tool_error`. Ordering and token behavior for a delegated `RuntimeAdapter` depend on that adapter.

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
  limits?: ExecutionLimits;
  signal?: AbortSignal;
}

class AgentRunner {
  run(agentName: string, input: RunInput): Promise<AgentResult>;
  runStream(
    agentName: string,
    input: RunInput,
  ): AsyncIterable<AgentStreamEvent>;
  settleApproval(
    pending: PendingApproval,
    decision: ApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult>;
}
```

`settleApproval()` is what `ApprovalService.approve()`/`reject()` call internally. It re-resolves `pending.agentName` and its tool sets, invokes the tool (on approval) or builds a denial (on rejection), and, when the approval carries a `toolCallId`, resumes the suspended turn through `AgentExecutor.resume()`. Most applications call `ApprovalService` rather than this method directly.

`run()` resolves the registered agent, creates the context, and resolves governed tools. Execution is then routed by registration:

| Registered | Behavior |
| --- | --- |
| `ModelAdapter` | Runs the built-in `AgentExecutor` loop. Takes precedence when both are registered. |
| `RuntimeAdapter` only | Delegates the whole turn to that adapter, as in earlier releases. |
| Neither | Throws `RuntimeNotConfiguredError`. |

`runStream()` follows the same routing. With a `RuntimeAdapter` that has no `stream()`, it converts a completed `AgentResult` into tool, token, and completion events.

## Approval API

```typescript
interface PendingApproval {
  id: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  expiresAt?: Date; // when set, resolving past this instant throws ApprovalExpiredError
  toolCallId?: string;
  checkpoint?: ApprovalCheckpoint; // snapshot of the suspended turn
}

interface ApprovalCheckpoint {
  version: number;
  // Conversation up to and including the withheld tool message, untrimmed
  // and without system messages.
  messages: ModelMessage[];
}

interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
  // Atomically remove and return the approval, or null if already claimed.
  claim(id: string): Promise<PendingApproval | null>;
}

type ApprovalDecision = { approved: true } | { approved: false; reason?: string };

interface SettleApprovalOptions {
  // Identity of the human or system making the decision, recorded on the
  // audit trail. Omitting it records that an approval was settled but not
  // who settled it.
  actor?: AuditActor;
  signal?: AbortSignal;
}

class ApprovalService {
  approve(
    approvalId: string,
    options?: SettleApprovalOptions,
  ): Promise<AgentResult | ToolExecutionResult>;
  reject(
    approvalId: string,
    options?: SettleApprovalOptions & { reason?: string },
  ): Promise<AgentResult | ToolExecutionResult>;
}
```

`PendingApproval` is a plain serializable record rather than a closure over live objects, so an `ApprovalStore` can persist it across a process restart or resolve it from a different instance than the one that created it. Approving or rejecting re-resolves the agent, its tool sets, and the tool method through NestJS DI using `agentName` and `toolName`.

Behavior of `approve()` and `reject()`:

- When the approval originated from the built-in runtime (it carries a `toolCallId`), the tool outcome is spliced into the exact suspended tool message in the persisted transcript and the model turn **resumes**: the model sees the outcome and can answer, request another tool, or suspend again. The return value is the full `AgentResult`.
- When the approval did not originate from the built-in runtime (no `toolCallId`, for example an agent driven entirely by a `RuntimeAdapter`), only the tool is invoked or the denial is built, and the bare `ToolExecutionResult` is returned, matching `0.4.x` behavior.
- Both methods throw `ApprovalNotFoundError` if the ID is unknown or was already resolved. Approvals are single-use.
- Resuming uses the approval's own `checkpoint`, so it does not depend on `SessionStore`. Approvals without one (created before checkpointing, or by a `RuntimeAdapter`) fall back to session history and throw `ApprovalTranscriptMissingError` if it was cleared or trimmed past the suspension point.

**Exactly-once settlement.** `approve()` and `reject()` claim the approval through `ApprovalStore.claim()` — an atomic remove-and-return — before running the withheld tool. This makes settlement at most once: two concurrent `approve()` calls for the same id, or a retry triggered by a restart, result in exactly one that runs the side effect while the others throw `ApprovalNotFoundError`. Because the claim happens first, a tool that fails after being claimed will not be retried; making the underlying side effect idempotent remains the tool's responsibility. `InMemoryApprovalStore` claims atomically within a process; `RedisApprovalStore` uses `GETDEL` for cross-instance atomicity when the client supports it.

**Execution checkpoints.** When the built-in runtime suspends a turn, it snapshots the conversation up to and including the withheld tool message onto the approval as a versioned `checkpoint`. Resuming reads that snapshot, so a turn survives session history being trimmed or cleared, and no longer depends on `SessionStore` retention outliving the approval. The checkpoint is written before the suspended turn returns, so it is durable before any caller can learn the `approvalId`. A record whose `checkpoint.version` this release does not support is refused with `ApprovalCheckpointVersionError` rather than misread. Checkpoints are untrimmed by design, so a long turn's approval record is proportionally larger than its trimmed session transcript.

**Expiry.** An approval can carry an `expiresAt`. It is set from the `require_approval` policy's own `ttlSeconds`, or failing that the module's `approvalTtlSeconds` (`AgenticModule.forRoot({ approvalTtlSeconds })`); when neither is set the approval never expires. Resolving an approval after its `expiresAt` throws `ApprovalExpiredError` rather than executing a decision against stale context, and the expired approval is consumed (the claim removes it) so it is not left behind for a retry. `RedisApprovalStore` derives the key's Redis TTL from `expiresAt` plus an `expiryGraceSeconds` window (default 300s) so abandoned approvals are garbage-collected while a just-expired one can still be claimed to report the precise error.

```typescript
const outcome = await approvalService.approve(approvalId);
// outcome is AgentResult when resuming the built-in runtime, otherwise ToolExecutionResult
```

`RedisApprovalStore` is the production-intent `ApprovalStore` implementation:

```typescript
new RedisApprovalStore({
  client: redisClient,
  keyPrefix: 'agentic:approval:', // default
  ttlSeconds: undefined,          // unset by default; approvals never expire
});
```

## Module Configuration

```typescript
interface AgenticModuleOptions {
  defaultModel: ModelConfig;
  stateStore?: StateStore;
  /** Activates the built-in runtime. Equivalent to providing MODEL_ADAPTER. */
  modelAdapter?: ModelAdapter;
  /** Default execution budgets for every run. */
  limits?: ExecutionLimits;
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
  modelAdapter: myModelAdapter,
  limits: { maxIterations: 6 },
});

AgenticModule.forFeature({
  agents: [SupportAgent],
  toolSets: [OrderTools],
  policies: [RefundLimitPolicy],
});
```

The application must register either a `ModelAdapter` or a `RuntimeAdapter`. Passing `modelAdapter` to `forRoot()` is the recommended path, because `AgentExecutor` is instantiated inside `AgenticModule` and resolves the token from that context.

Two `forFeature()` rules follow from it registering providers in the `AgenticModule` context:

1. Register an agent together with its tool sets and policies in a **single** `forFeature()` call. Separate calls create separate module contexts, so an agent cannot inject a tool set registered by another call.
2. Application services injected by agents or tool sets must be exported from a `@Global()` module.

## Conversation History

The built-in runtime replays and persists conversation per session, so a second `run()` on the same `sessionId` continues the conversation.

```typescript
interface SessionOptions {
  enabled?: boolean; // default true
  maxMessages?: number; // default 40
}

interface SessionRecord {
  sessionId: string;
  messages: ModelMessage[];
  updatedAt: string;
}
```

Behavior:

- History is stored through `SessionStore`, defaulting to the process-local `InMemorySessionStore`. Provide `sessionStore` to `forRoot()` for anything durable.
- The storage key is `tenantId:sessionId` when a tenant is present, so the same session identifier used by two tenants can never share a transcript.
- System messages are not stored, because agent instructions are applied again on every turn.
- Retention keeps the most recent `maxMessages`. Trimming never leaves a tool result without the assistant message that requested it, which providers reject.
- History is written when a turn ends, including when it suspends for approval. A turn that throws does not persist a partial transcript.
- A failing history read never fails the turn; the agent continues without history.
- Set `RunInput.history` to `false` for a stateless turn, or `session.enabled` to `false` to disable it globally.
- Applies to the built-in runtime only. A `RuntimeAdapter` receives a single message and owns its own state.

```typescript
await runner.run('assistant', { sessionId: 's1', message: 'My name is Sara' });
await runner.run('assistant', { sessionId: 's1', message: 'What is my name?' });
```

## Session and State Stores

```typescript
interface SessionStore {
  get(sessionId: string): Promise<unknown | null>;
  set(sessionId: string, data: unknown): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

// Values written by the runtime can be narrowed with:
function isSessionRecord(value: unknown): value is SessionRecord;

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
| `RedisApprovalStore` | JSON-serializing `ApprovalStore` using a compatible Redis client. Supports optional TTL-based expiry. |
| `InMemorySessionStore` | Default session store; process-local. |
| `RedisSessionStore` | JSON-serializing `SessionStore` using a compatible Redis client. Supports optional TTL-based expiry. |
| `InMemoryStateStore` | Default `STATE_STORE`; process-local. |
| `RedisStateStore` | JSON-serializing `StateStore` using a compatible Redis client. |

```typescript
const sessionStore = new RedisSessionStore({
  client: redisClient,
  keyPrefix: 'agentic:session:',
  ttlSeconds: 86400, // optional 24-hour expiration
});

const stateStore = new RedisStateStore({
  client: redisClient,
  keyPrefix: 'agentic:state:',
});

AgenticModule.forRoot({
  defaultModel: { provider: 'mock', model: 'deterministic' },
  sessionStore,
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

## Audit Trail

```typescript
interface AuditActor {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  label?: string; // for non-user actors, e.g. 'ops-console'
}

interface AuditEventBase {
  at: Date;
  sessionId: string;
  traceId: string;
  tenantId?: string;
}

type AuditEvent =
  | ToolPolicyDecisionAuditEvent      // a call crossed the policy boundary
  | ApprovalRequestedAuditEvent       // a call was withheld for approval
  | ApprovalSettledAuditEvent         // a human approved or rejected it
  | ApprovalExpiredAuditEvent         // a late decision was refused
  | ApprovalSettlementFailedAuditEvent; // the tool failed after being claimed

interface AuditSink {
  record(event: AuditEvent): void | Promise<void>;
}

interface AuditOptions {
  includeArgs?: boolean; // default false
  sensitiveFields?: string[];
  includeAllowDecisions?: boolean; // default false
}

class AuditTrail {
  isEnabled(): boolean;
  record(event: AuditEvent): Promise<void>;
}
```

Records governance decisions — what was gated, why, and who resolved it — to every registered `AuditSink`.

Auditing is **opt-in**: with no sink registered nothing is recorded. Register sinks through `auditSinks` on `forRoot()`, or the `AUDIT_SINKS` token directly.

```typescript
AgenticModule.forRoot({
  defaultModel: { provider: 'openai', model: 'gpt-4o' },
  auditSinks: [new ConsoleAuditSink(), new MyDatabaseAuditSink(repo)],
  audit: { includeArgs: true, sensitiveFields: ['cardNumber'] },
});
```

Recorded events:

| Event | When |
| --- | --- |
| `tool_policy_decision` | a policy returned `deny`, `require_approval`, or (opt-in) `allow` |
| `approval_requested` | a tool call was withheld and a pending approval created |
| `approval_settled` | a human approved or rejected, and the outcome was applied |
| `approval_expired` | a settlement was refused because the approval had expired |
| `approval_settlement_failed` | the tool failed *after* the approval was claimed |

`approval_settlement_failed` is the one worth alerting on: the claim already consumed the approval, so it cannot be retried, and the tool may have applied part of its side effect before failing.

### Recording who decided

Identity is application-owned — the framework never infers it. Pass `actor` when settling so the trail records who decided:

```typescript
await approvals.approve(approvalId, {
  actor: { userId: req.user.id, roles: req.user.roles, label: 'ops-console' },
});
```

`actor` is optional for compatibility, but omitting it records *that* an approval was settled without recording *who* settled it, which most review processes will not accept.

### Defaults chosen for safety and volume

- **Arguments are withheld** unless `includeArgs` is set. They can carry secrets and personal data, and an audit store usually outlives application logs. When enabled, `sensitiveFields` masks named fields, descending into nested objects.
- **`allow` decisions are not recorded** unless `includeAllowDecisions` is set, because every framework-managed tool call produces one; that volume belongs to tracing rather than an audit trail.
- **A failing sink never fails the operation.** Each sink is isolated, so an unreachable audit backend cannot fail an already-approved refund. The tradeoff is explicit: an entry can be lost. A sink that must not lose events should buffer durably itself.

Built-in sinks: `InMemoryAuditSink` (tests and local inspection, with `all()` and `ofType()`) and `ConsoleAuditSink` (one greppable line per event). Neither is a queryable audit store; production deployments should write to a durable one.

Model and tool execution traces and metrics are not part of this surface — they belong to the observability milestone.

## Adapter Contract Suite

```typescript
function runModelAdapterContract(
  options: ModelAdapterContractOptions,
): Promise<ModelAdapterContractResult>;

interface ModelAdapterContractOptions {
  name: string;
  createAdapter(
    scenario: ModelAdapterContractScenario,
  ): ModelAdapter | Promise<ModelAdapter>;
  supportsStreaming?: boolean; // default true
  reportsUsage?: boolean; // default true
  model?: ModelConfig;
  log?: boolean; // default true
}

interface ModelAdapterContractScenario {
  content?: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
}

interface ModelAdapterContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}
```

Runs the behavioral contract for a `ModelAdapter` so any implementation, including a third-party one, can prove it behaves the way the runtime expects.

Each scenario describes a single provider round, because that is the unit a `ModelAdapter` is responsible for. Multi-round behavior belongs to `AgentExecutor`.

You supply `createAdapter`, which returns an adapter whose provider deterministically produces the scenario. For a real provider that usually means injecting a stub transport. The harness always sends `CONTRACT_SYSTEM_MESSAGE` and `CONTRACT_USER_MESSAGE` with `CONTRACT_TOOLS`, all exported, so a factory can key its stub on them.

Checked behavior:

- content resolves as a string, for both text and tool rounds
- a text round reports no tool calls
- tool calls carry an id and name, with arguments parsed into an object rather than left as JSON text
- argument values and types survive translation
- assistant and tool messages in the conversation are accepted
- usage maps onto framework token fields when the provider reports it
- the request messages array is not mutated
- `finishReason` is a known value when present
- `generate()` rejects when the request signal is already aborted
- `stream()` emits exactly one `response` chunk, last, whose content matches the round and whose tool calls are parsed

```typescript
const result = await runModelAdapterContract({
  name: 'MyModelAdapter',
  createAdapter: (scenario) => new MyModelAdapter({ fetch: stubFor(scenario) }),
});

if (result.failed > 0) {
  throw new Error(result.failures.join('\n'));
}
```

Set `supportsStreaming: false` or `reportsUsage: false` to skip capabilities an adapter intentionally omits; skipped assertions are counted separately rather than silently passing.

## Approval Store Contract Suite

```typescript
function runApprovalStoreContract(
  options: ApprovalStoreContractOptions,
): Promise<ApprovalStoreContractResult>;

interface ApprovalStoreContractOptions {
  name: string;
  createStore(): ApprovalStore | Promise<ApprovalStore>;
  supportsAtomicClaim?: boolean; // default true
  log?: boolean; // default true
}

interface ApprovalStoreContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}
```

Runs the behavioral contract for an `ApprovalStore` so any implementation, including a third-party one, can prove it behaves the way the runtime expects. `createStore` is called once per assertion group, so each group starts from an empty store.

The contract treats an approval as serializable data rather than a live object. That distinction matters: a store that works only because it shares object references within one process would pass a naive test and then fail behind Redis.

Checked behavior:

- a saved approval reads back with its id, names, reason, `toolCallId`, context, and nested argument values and types intact
- `createdAt` and `expiresAt` round-trip as `Date` instances, not ISO strings
- an approval saved without `expiresAt` or `checkpoint` reads back without them
- the resume `checkpoint` survives storage, retaining every message including the withheld tool message and the assistant tool-call message
- a returned record is isolated: mutating it does not change stored state
- `save()` with an existing id replaces the record, which is how a checkpoint is attached after the fact
- `get()` and `claim()` return `null` for an unknown id, and `delete()` of an unknown id resolves rather than throwing
- `delete()` removes the record
- `claim()` returns the record, removes it, and is single-use
- `claim()` is atomic: of several concurrent callers, exactly one receives the record
- claiming one approval leaves others untouched

```typescript
const result = await runApprovalStoreContract({
  name: 'MyApprovalStore',
  createStore: () => new MyApprovalStore({ client: redis }),
});

if (result.failed > 0) {
  throw new Error(result.failures.join('\n'));
}
```

Set `supportsAtomicClaim: false` for a store that cannot claim atomically across concurrent callers — for example `RedisApprovalStore` behind a client without `GETDEL`, which falls back to a non-atomic get+del. The concurrency assertions are then skipped and counted separately rather than reported as failures. Both built-in stores, and the `GETDEL` fallback path, are verified against this suite.

## `runSessionStoreContract`

```typescript
function runSessionStoreContract(
  options: SessionStoreContractOptions,
): Promise<SessionStoreContractResult>;

interface SessionStoreContractOptions {
  name: string;
  createStore(): SessionStore | Promise<SessionStore>;
  log?: boolean;
}

interface SessionStoreContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}
```

Runs the behavioral contract for a `SessionStore` to verify that an implementation accurately persists session records, isolates returned objects from internal store mutations, and maintains multi-tenant separation.

Checked behavior:

- `get()` returns `null` for an unknown session key
- saved records round-trip with their `sessionId`, `messages`, and `updatedAt` timestamps intact
- `delete()` removes the session record
- subsequent `set()` overwrites the previous record
- records across different tenants and sessions remain isolated
- mutating a returned record does not mutate internal store state

```typescript
const result = await runSessionStoreContract({
  name: 'MySessionStore',
  createStore: () => new MySessionStore({ client: redis }),
});

if (result.failed > 0) {
  throw new Error(result.failures.join('\n'));
}
```

## `MockModelAdapter`

Deterministic `ModelAdapter` for testing the full loop without a provider.

```typescript
const model = new MockModelAdapter();

model
  .whenAsked('Refund $600 for order #42')
  .callTool('lookupOrder', { orderId: '42' })
  .callTool('refundOrder', { orderId: '42', amount: 600 })
  .reply('Refund submitted.');

// Multiple tools in a single round
model.whenAsked('Check both orders').callTools([
  { name: 'lookupOrder', args: { orderId: '1' } },
  { name: 'lookupOrder', args: { orderId: '2' } },
]);

model.reset();
```

Each `callTool` or `callTools` entry describes one model round, and `reply()` ends the script with a final answer. Rounds are selected by counting assistant messages in the request, so scripts remain stable across concurrent runs. Unscripted messages return a deterministic mock response.

Pass `new MockModelAdapter({ usagePerRound })` to exercise token budgets.

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
| `MODEL_ADAPTER` | Model provider used by the built-in runtime | Optional; activates `AgentExecutor` when registered. |
| `RUNTIME_ADAPTER` | External runtime that owns the whole turn | Optional; used when no `ModelAdapter` is registered. |
| `APPROVAL_STORE` | `ApprovalStore` implementation | Defaults to `InMemoryApprovalStore`. |
| `SESSION_STORE` | `SessionStore` implementation | Defaults to `InMemorySessionStore`. |
| `STATE_STORE` | `StateStore` implementation | Defaults to `InMemoryStateStore`. |
| `AGENT_OBSERVERS` | Observer multi-provider contract | Exported but not dispatched by `AgentRunner` in `0.4.x`. |

Other exported constants primarily support framework metadata and internal provider discovery and should not be treated as stable application extension points before 1.0.
