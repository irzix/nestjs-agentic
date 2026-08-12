# Customer Support Example

A NestJS application showing the recommended path: the built-in agent runtime driven by `@nestjs-agentic/openai`, with governed tools, a refund policy, and human approval.

It demonstrates a real model-to-tool loop. The model looks up an order, requests a refund, receives the tool result, and answers, while every tool call passes through the policy boundary first.

## What it shows

- `@ToolSet` and `@Tool`: `OrderTools` exposes `getOrder` and `refundOrder` from an ordinary `OrderService`.
- `@UsePolicies`: `RefundLimitPolicy` requires approval for refunds above $500.
- `@Context`: the caller identity is bound server-side, so the model cannot choose whose order to read.
- `ApprovalService`: approves or rejects a withheld refund.
- Execution budgets: `forRoot()` caps iterations, tool calls, and wall-clock time.

## Structure

```text
src/
├── model.factory.ts          # builds the OpenAI adapter from env
├── app.module.ts             # forRoot(): default model, adapter, budgets
├── order/
│   ├── order.service.ts      # plain NestJS service
│   ├── order.module.ts       # @Global() so tool sets can inject the service
│   ├── policies/refund-limit.policy.ts
│   └── tools/order.tools.ts
├── support/
│   ├── agents/support.agent.ts
│   ├── support.controller.ts
│   └── support.module.ts     # single forFeature() for agent, tools, policies
└── main.ts
```

Two registration rules are worth copying:

1. Register an agent, its tool sets, and its policies in **one** `forFeature()` call. Separate calls create separate module contexts, so an agent cannot inject a tool set registered elsewhere.
2. Services injected by tool sets must come from a `@Global()` module, because `forFeature()` registers tool sets inside the `AgenticModule` context.

## Run it

```bash
export OPENAI_API_KEY=sk-...
npm run start:dev --workspace=example-customer-support
```

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_MODEL` | Model name. Defaults to `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | Point at any Chat Completions compatible server, for example `http://localhost:11434/v1` for Ollama. |
| `PORT` | HTTP port. Defaults to `3000`. |

### Endpoints

```bash
# Under the limit: runs the full loop and refunds immediately
curl -X POST http://localhost:3000/support/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"s1","message":"Refund $200 for order 456","userId":"user-1"}'

# Over the limit: returns pending_approval with an approvalId
curl -X POST http://localhost:3000/support/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"s2","message":"Refund $600 for order 123","userId":"user-1"}'

# Apply the withheld refund
curl -X POST http://localhost:3000/support/approve/<approvalId>
```

Seeded orders: `123` for $600 and `456` for $200, both owned by `user-1`.

## Tests

```bash
npm test --workspace=example-customer-support
```

The suite boots this application and replaces only the model adapter with a scripted OpenAI endpoint, so it runs offline with no API key while still exercising NestJS wiring, the executor loop, real OpenAI request translation, and SSE streaming.

Covered behavior:

- multi-round loop with tool results fed back to the model
- refunds above the limit suspend for approval, then apply exactly once
- the caller identity is enforced by the service, not the model
- incomplete tool arguments are rejected before the service runs and reported back to the model
- streaming emits provider tokens plus ordered tool lifecycle events
- the configured iteration budget stops a looping model

## Current limitations

Approval executes the withheld tool but does not resume the original model turn, and pending approvals live in memory, so they do not survive a restart. Durable resume is planned in the roadmap.
