# LangGraph Stateful Workflow Example (`example-langgraph-workflow`)

A production-ready NestJS example demonstrating **LangGraph agent orchestration** integrated with **nestjs-agentic enterprise governance**, multi-tenant policy enforcement, and parameter context binding.

---

## 🌟 Key Architecture Features

1. **`LangGraphRuntimeAdapter`**: Uses `@nestjs-agentic/langgraph` to map NestJS policy-guarded tool closures (`ResolvedTool`) directly into LangGraph state nodes.
2. **`InventoryAccessPolicy`**: Enforces strict tenant boundaries and blocks suspended accounts at the policy layer before tools execute.
3. **`InventoryTools`**: `@ToolSet({ name: 'inventory-tools' })` providing warehouse tools (`checkStock`, `reserveStock`) with `@Context()` pre-binding.
4. **`InventoryAgent`**: `@Agent({ name: 'inventory-agent' })` bound via `AgenticModule.forFeature()`.

---

## 📁 Directory Structure

```text
examples/langgraph-workflow/
├── src/
│   ├── agent/
│   │   └── inventory.agent.ts       # @Agent provider definition
│   ├── policies/
│   │   └── inventory-access.policy.ts # Tenant isolation & security policy
│   ├── tools/
│   │   └── inventory.tools.ts       # @ToolSet providing warehouse tools
│   ├── app.module.ts                # AgenticModule.forRoot() & forFeature()
│   └── test-langgraph.ts            # Integration test suite (8 assertions)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 Running the Example & Tests

### 1. Execute Integration Tests

Run the dedicated 8-assertion integration test suite:

```bash
npm test
```

### Expected Output:

```text
🌐 Starting LangGraph Workflow Integration Tests...
✅ App Context Created Successfully
  ✅ PASS: Test 1a: Returned correct sessionId
  ✅ PASS: Test 1b: LangGraph executed inventory tools
  ✅ PASS: Test 1c: checkStock tool executed via LangGraph closure
  ✅ PASS: Test 1d: Inventory quantity 150 returned successfully
  ✅ PASS: Test 1e: AgentContext tenantId pre-bound into @Context() parameter
  ✅ PASS: Test 2a: Policy decision "deny" returns success: false
  ✅ PASS: Test 2b: Execution status is "denied"
  ✅ PASS: Test 2c: Policy evaluation reason contains suspension details

  📊 Summary: 8 passed, 0 failed.
```

---

## 💡 Code Snippet: Registering LangGraph Adapter in NestJS

```typescript
import { Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from '@nestjs-agentic/core';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';
import { InventoryAgent } from './agent/inventory.agent';
import { InventoryTools } from './tools/inventory.tools';
import { InventoryAccessPolicy } from './policies/inventory-access.policy';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    }),
    AgenticModule.forFeature({
      agents: [InventoryAgent],
      toolSets: [InventoryTools],
      policies: [InventoryAccessPolicy],
    }),
  ],
  providers: [
    {
      provide: RUNTIME_ADAPTER,
      useClass: LangGraphRuntimeAdapter,
    },
  ],
})
export class AppModule {}
```
