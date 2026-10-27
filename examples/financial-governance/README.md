# Financial Governance Example

A modular NestJS example for evaluating policy chaining, application-owned tenant and role context, deterministic mock-runtime tests, and the current process-local approval API.

This example demonstrates governance primitives; it is not proof of production tenant isolation, durable audit, distributed rate limiting, or restart-safe approval. Applications and persistence layers must enforce those guarantees.

## Architecture

```text
src/
├── app.module.ts
├── main.ts
├── accounts/
│   ├── account.service.ts
│   └── accounts.module.ts
├── governance/
│   ├── policies/tenant-isolation.policy.ts
│   ├── policies/tiered-transfer.policy.ts
│   └── governance.module.ts
└── banking/
    ├── banking.agent.ts
    ├── banking.controller.ts
    ├── banking.tools.ts
    └── banking.module.ts
```

## Features Demonstrated

1. NestJS modules separate domain services, policies, tools, and agents.
2. `@UsePolicies(TenantIsolationPolicy, TieredTransferPolicy)` evaluates policies before a framework-managed tool invocation.
3. Application-provided `AgentContext` carries tenant, user, and role data; the model does not author this security context.
4. Transfers above the configured threshold can return `pending_approval`.
5. Tests override `RUNTIME_ADAPTER` with a configured `MockRuntimeAdapter`, so tool names and arguments are deterministic and no model API is called.

Approval executes only the stored pending invocation. The closure is process-local, cannot survive restart, and does not resume the original model turn.

## Build and Test

```bash
npm run build
npm test
```

## Run the HTTP Example

```bash
npm start
```

The HTTP application registers the experimental ADK-named runtime prototype. It does not make a provider-native model call; on every run it invokes resolved tools in registration order with empty arguments and stops early only if a tool returns `pending_approval`. Do not use the HTTP flow for real financial side effects.

## Minimal refund walkthrough

```sh
npm run build --workspace=@nestjs-agentic/core
npm run build --workspace=nestjs-agentic
npm run demo:refund --workspace=example-financial-governance
```

`src/refund-demo.ts` runs without API keys and uses a deterministic **model** adapter
with the real agent tool loop. It checks tenant-owned order data and amount before
requesting approval, closes and recreates the Nest container, refuses the requester,
a cross-tenant manager and an unauthorized viewer, then resumes with a finance
manager. Repeated approval is refused; a second approved request for the same order
is deduplicated at the business ledger. Audit events identify the approver.

The demo runs in the example's normal `npm test` command and asserts each outcome.

### What this proves and what it does not

The stores, ledger and audit sink are in-memory objects deliberately shared across
two Nest containers. This demonstrates dependency re-resolution and checkpoint
resumption, **not process-crash durability**. Use Redis/Postgres stores and a durable
audit sink for real restarts. Test actual process termination separately.

The ledger is a single-process stand-in for a transactional database operation with
a unique `(tenantId, orderId)` refund key. In production, put deduplication at the
payment destination or use a transactional outbox; an approval claim alone cannot
guarantee exactly-once payment. All actor identities here are trusted test fixtures,
not authentication. An HTTP application must derive identity and roles from its
authenticated session, never from an untrusted request body or the model.
