# Enterprise Financial Governance Demo

> Full modular NestJS example of **nestjs-agentic** featuring multi-policy evaluation, multi-tenant security isolation, role-based access control, and Human-in-the-Loop (HITL) approval mechanics.

---

## Architecture Overview

```
src/
├── app.module.ts              # Root NestJS module configuring AgenticModule.forRoot()
├── main.ts                    # NestJS bootstrap entrypoint
├── accounts/                  # Domain Feature Module (Banking Ledger)
│   ├── account.service.ts
│   └── accounts.module.ts
├── governance/                # Governance Feature Module (Security & Policies)
│   ├── policies/
│   │   ├── tenant-isolation.policy.ts
│   │   └── tiered-transfer.policy.ts
│   └── governance.module.ts
└── banking/                   # Agent Feature Module (Agent, Tools & HTTP Controller)
    ├── banking.agent.ts
    ├── banking.controller.ts
    ├── banking.tools.ts
    └── banking.module.ts
```

---

## Key Features Demonstrated

1. **Modular NestJS Design**: Clean separation of Domain Modules (`AccountsModule`), Governance Modules (`GovernanceModule`), and Agent Feature Modules (`BankingModule`).
2. **Multi-Policy Chaining**: `@UsePolicies(TenantIsolationPolicy, TieredTransferPolicy)` evaluated sequentially before any tool call executes.
3. **Role & Tenant Governance**:
   - `TenantIsolationPolicy`: Ensures requests contain valid tenant context.
   - `TieredTransferPolicy`: Checks user roles (`finance_officer`) and enforces transfer caps.
4. **Human-in-the-Loop (HITL) Workflow**: Transfers exceeding $10,000 trigger a `pending_approval` state, requiring a supervisor to call `POST /finance/approve/:approvalId`.

---

## Running the Example

### 1. Environment Setup

Ensure your Gemini API key is configured:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
```

### 2. Build & Start

```bash
cd examples/financial-governance
npm run build
npm start
```

---

## API Endpoints & Testing

### 1. Low-Risk Transfer (Auto-Allowed)

```bash
curl -X POST http://localhost:3001/finance/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "s1",
    "message": "Transfer $500 from ACC-100 to ACC-200",
    "userId": "usr_safe",
    "tenantId": "acme_corp",
    "roles": ["finance_officer"]
  }'
```

### 2. High-Value Transfer (Triggers HITL Approval)

```bash
curl -X POST http://localhost:3001/finance/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "s2",
    "message": "Transfer $25000 from ACC-100 to ACC-300",
    "userId": "usr_corp",
    "tenantId": "acme_corp",
    "roles": ["finance_officer"]
  }'
```

### 3. Approve Pending Transfer

```bash
curl -X POST http://localhost:3001/finance/approve/app_1723456789_abcd
```

### 4. Reject Pending Transfer

```bash
curl -X POST http://localhost:3001/finance/reject/app_1723456789_abcd
```
