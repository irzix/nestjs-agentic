import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Global, Injectable, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Agent, AgenticModule, AgentRunner, ApprovalService, Context, Param, Tool, ToolSet, UsePolicies,
  InMemoryApprovalStore, InMemorySessionStore, InMemoryStateStore, InMemoryAuditSink,
} from 'nestjs-agentic';
import type { AgentConfig, AgentContext, AgentProvider, ModelAdapter, PolicyResult, ToolExecutionResult, ToolPolicy } from 'nestjs-agentic';

/** Application-owned business data. Use a database transaction/unique key in production. */
@Injectable()
class RefundLedger {
  readonly orders = new Map([['order-42', { tenantId: 'acme', amount: 600 }]]);
  readonly refunds = new Map<string, { orderId: string; amount: number }>();
  refund(ctx: AgentContext, orderId: string, amount: number) {
    const order = this.orders.get(orderId);
    if (!order || order.tenantId !== ctx.security.tenantId || amount !== order.amount) {
      throw new Error('Refund no longer matches the authorized order');
    }
    const key = JSON.stringify([ctx.security.tenantId, orderId]);
    const previous = this.refunds.get(key);
    if (previous) return previous;
    const receipt = { orderId, amount };
    this.refunds.set(key, receipt);
    return receipt;
  }
}

@Injectable()
class RefundPolicy implements ToolPolicy {
  constructor(private readonly ledger: RefundLedger) {}
  async evaluate(ctx: AgentContext, _name: string, args: Record<string, unknown>): Promise<PolicyResult> {
    const order = this.ledger.orders.get(String(args.orderId));
    if (!order || order.tenantId !== ctx.security.tenantId) {
      return { decision: 'deny', reason: 'Order is not accessible in this tenant' };
    }
    if (typeof args.amount !== 'number' || args.amount <= 0 || args.amount !== order.amount) {
      return { decision: 'deny', reason: 'Refund must match the order amount' };
    }
    return { decision: 'require_approval', reason: 'Refund requires a finance manager', ttlSeconds: 300 };
  }
}

@ToolSet({ name: 'refunds' })
class RefundTools {
  constructor(private readonly ledger: RefundLedger) {}
  @Tool({ name: 'refundOrder', description: 'Refund an order after policy and human approval' })
  @UsePolicies(RefundPolicy)
  refundOrder(@Param('orderId') orderId: string, @Param('amount', { type: 'number' }) amount: number, @Context() ctx: AgentContext) {
    return this.ledger.refund(ctx, orderId, amount);
  }
}

@Agent({ name: 'refund-demo', description: 'Minimal governed refund agent' })
class RefundAgent implements AgentProvider {
  constructor(private readonly tools: RefundTools) {}
  define(): AgentConfig { return { instructions: 'Refund the order using the governed tool.', tools: [this.tools] }; }
}

@Global()
@Module({})
class Infrastructure {
  static register(ledger: RefundLedger): DynamicModule {
    return { module: Infrastructure, providers: [{ provide: RefundLedger, useValue: ledger }], exports: [RefundLedger] };
  }
}

export async function runRefundDemo() {
  const ledger = new RefundLedger();
  const audit = new InMemoryAuditSink();
  // Keeping these objects across Nest containers demonstrates checkpoint resumption,
  // not process-crash durability. Replace with persistent adapters for real restarts.
  const stores = { approvalStore: new InMemoryApprovalStore(), sessionStore: new InMemorySessionStore(), stateStore: new InMemoryStateStore() };
  const model: ModelAdapter = {
    async generate(request) {
      const outcome = request.messages.filter((m) => m.role === 'tool').at(-1);
      return outcome
        ? { content: `Tool outcome: ${outcome.content}` }
        : { content: '', toolCalls: [{ id: 'refund-call', name: 'refundOrder', args: { orderId: 'order-42', amount: 600 } }] };
    },
  };
  const open = () => Test.createTestingModule({ imports: [
    Infrastructure.register(ledger),
    AgenticModule.forRoot({ ...stores, modelAdapter: model, defaultModel: { model: 'deterministic' }, auditSinks: [audit],
      approvals: { enforceTenantIsolation: true, enforceSeparationOfDuties: true },
      approvalAuthorizer: { canSettle: (_approval, actor) => actor?.roles?.includes('finance_manager') ?? false },
    }),
    AgenticModule.forFeature({ agents: [RefundAgent], toolSets: [RefundTools], policies: [RefundPolicy] }),
  ] }).compile();
  const context = { tenantId: 'acme', userId: 'requester' };
  let app = await open();
  try {
    const denied = await app.get(AgentRunner).run('refund-demo', { sessionId: 'other-tenant', message: 'Refund order', context: { ...context, tenantId: 'other' } });
    const deniedResult = denied.toolCalls[0].result as ToolExecutionResult;
    assert(!deniedResult.success && deniedResult.status === 'denied');
    assert.equal(ledger.refunds.size, 0);

    const result = await app.get(AgentRunner).run('refund-demo', { sessionId: 'refund-request', message: 'Refund order', context });
    const pending = result.toolCalls[0].result as ToolExecutionResult;
    assert(!pending.success && pending.status === 'pending_approval');
    const id = pending.approvalId;
    assert.equal(ledger.refunds.size, 0);
    console.log('Refund withheld; approval checkpoint persisted in the configured store.');
    await app.close();
    app = await open();
    const approvals = app.get(ApprovalService);
    // Actors here are trusted fixture identities. An HTTP app must authenticate them.
    await assert.rejects(() => approvals.approve(id, { actor: { ...context, roles: ['finance_manager'] } }));
    await assert.rejects(() => approvals.approve(id, { actor: { userId: 'manager', tenantId: 'other', roles: ['finance_manager'] } }));
    await assert.rejects(() => approvals.approve(id, { actor: { userId: 'viewer', tenantId: 'acme', roles: ['viewer'] } }));
    assert.equal(ledger.refunds.size, 0);

    const actor = { userId: 'manager', tenantId: 'acme', roles: ['finance_manager'] };
    const resumed = await approvals.approve(id, { actor });
    assert('output' in resumed && resumed.output.includes('order-42'));
    assert.equal(ledger.refunds.size, 1);
    await assert.rejects(() => approvals.approve(id, { actor }));
    // A new request for the same business operation also cannot refund twice.
    const repeat = await app.get(AgentRunner).run('refund-demo', { sessionId: 'repeat-request', message: 'Refund again', context });
    const repeatPending = repeat.toolCalls[0].result as ToolExecutionResult;
    assert(!repeatPending.success && repeatPending.status === 'pending_approval');
    await approvals.approve(repeatPending.approvalId, { actor });
    assert.equal(ledger.refunds.size, 1);
    assert(audit.ofType('approval_requested').length >= 1);
    assert(audit.ofType('approval_settled').some((event) => event.actor?.userId === 'manager'));
    console.log(JSON.stringify({ refunds: [...ledger.refunds.values()], auditEvents: audit.all().map((e) => e.type) }, null, 2));
    console.log('PASS: tenant boundary, approver authorization, separation of duties, container resumption, business deduplication, audit.');
  } finally { await app.close(); }
}

if (require.main === module) runRefundDemo().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
