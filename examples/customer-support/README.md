# Customer Support Agent Example

A working NestJS application demonstrating **nestjs-agentic** with Google ADK runtime and Human-in-the-Loop (HITL) refund policy enforcement.

---

## Features Demonstrated

- 🛠️ **`@ToolSet` & `@Tool`**: `OrderTools` exposing `getOrder` and `refundOrder`.
- 🛡️ **`@UsePolicies`**: `RefundLimitPolicy` requiring human approval for refunds > $500.
- 🛑 **HITL Flow**: Pauses refund tool execution and returns a pending `approvalId`.
- 🔌 **Google ADK Adapter**: Powered by `@nestjs-agentic/adk`.

---

## Recommended Architecture & Best Practices

This demo uses the standard **Nest CLI Modular Architecture**:

- **Domain-bound Tools & Policies (`src/order/`)**:
  `tools/` and `policies/` live directly inside the feature module alongside services. Avoid wrapping them in artificial `agentic/` folders — in NestJS, tools and policies are first-class building blocks next to `dto/` and `services/`.
- **Orchestration Agents (`src/support/`)**:
  Agents that orchestrate tools across multiple feature modules live in their own dedicated NestJS module (`SupportModule`).

```
src/
├── order/                        # Feature module (nest g module order)
│   ├── policies/
│   │   └── refund-limit.policy.ts
│   ├── tools/
│   │   └── order.tools.ts        # @ToolSet
│   ├── order.service.ts
│   └── order.module.ts           # AgenticModule.forFeature({ toolSets, policies })
│
├── support/                      # Agent module (nest g module support)
│   ├── agents/
│   │   └── support.agent.ts      # @Agent (consumes OrderTools)
│   ├── support.controller.ts     # Chat & HITL approval HTTP endpoints
│   └── support.module.ts         # AgenticModule.forFeature({ agents })
│
├── app.module.ts                 # AgenticModule.forRoot({ defaultModel })
└── main.ts
```

## Getting Started

```bash
# 1. Add your Gemini API Key
export GEMINI_API_KEY="your-gemini-api-key"

# 2. Start dev server
npm run start:dev
```

Server starts on `http://localhost:3000`.

---

## API Usage Example

### 1. Chat Endpoint (Refund > $500 triggers HITL)

```bash
curl -X POST http://localhost:3000/support/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-1",
    "message": "Refund $600 for order #123",
    "userId": "user-1"
  }'
```

**Response:**
```json
{
  "sessionId": "session-1",
  "output": "Action requires supervisor approval (ID: app_98765). Refund of $600 exceeds auto-approval limit ($500).",
  "toolCalls": [
    {
      "toolName": "refundOrder",
      "args": { "orderId": "123", "amount": 600 },
      "result": {
        "success": false,
        "status": "pending_approval",
        "reason": "Refund of $600 exceeds auto-approval limit ($500).",
        "approvalId": "app_98765"
      }
    }
  ]
}
```

### 2. Approve HITL Action

```bash
curl -X POST http://localhost:3000/support/approve/app_98765
```

**Response:**
```json
{
  "success": true,
  "data": { "refunded": true, "amount": 600 }
}
```
