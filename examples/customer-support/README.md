# Customer Support Governance Example

A NestJS application demonstrating `@ToolSet`, policy evaluation, and the current process-local approval API. It registers the experimental `@nestjs-agentic/adk` compatibility adapter for evaluation.

## Important Limitations

The current ADK-named runtime prototype does not make a provider-native ADK or Gemini model call. On every run, it invokes resolved tools in registration order with empty arguments and stops early only if a tool returns `pending_approval`. Do not use this example as a side-effecting production deployment. Use `MockRuntimeAdapter` with configured scenarios to test refund arguments and policy behavior deterministically.

Approval protects one pending tool invocation. The continuation is process-local, does not survive a restart, and approval does not resume the original model turn.

## Features Demonstrated

- `@ToolSet` and `@Tool`: `OrderTools` exposes `getOrder` and `refundOrder`.
- `@UsePolicies`: `RefundLimitPolicy` can require approval for refunds above $500 when a runtime supplies the amount.
- `ApprovalService`: approves or rejects one pending process-local invocation.
- NestJS feature modules: tools, policies, agents, and controllers remain ordinary providers.

## Structure

```text
src/
├── order/
│   ├── policies/refund-limit.policy.ts
│   ├── tools/order.tools.ts
│   ├── order.service.ts
│   └── order.module.ts
├── support/
│   ├── agents/support.agent.ts
│   ├── support.controller.ts
│   └── support.module.ts
├── app.module.ts
└── main.ts
```

## Run for Evaluation

```bash
npm run start:dev
```

The server starts on `http://localhost:3000`. Review the adapter limitations above before calling endpoints. An API key does not cause the current ADK implementation to make a provider request.
