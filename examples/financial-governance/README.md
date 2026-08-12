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
