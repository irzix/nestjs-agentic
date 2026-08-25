import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  ApprovalNotAuthorizedError,
  ApprovalService,
  AuditTrail,
  Context,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySessionStore,
  LocalToolProvider,
  MockModelAdapter,
  Param,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  ApprovalAuthorizer,
  AuditActor,
  PendingApproval,
  PolicyResult,
  ToolPolicy,
} from '../src';

class HighValuePolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Requires a second pair of eyes.' }
      : { decision: 'allow' };
  }
}

@ToolSet({ name: 'ledger-authz' })
class LedgerTools {
  readonly transfers: Array<{ amount: number }> = [];

  @Tool({ name: 'transferMoney', description: 'Transfer funds' })
  @UsePolicies(HighValuePolicy)
  async transferMoney(
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Context() _ctx: AgentContext,
  ) {
    this.transfers.push({ amount });
    return { txId: 'tx_1', amount };
  }
}

@Agent({ name: 'banker', description: 'Handles transfers' })
class BankerAgent implements AgentProvider {
  constructor(private readonly tools: LedgerTools) {}

  define(): AgentConfig {
    return { instructions: 'Move money carefully.', tools: [this.tools] };
  }
}

class MockModuleRef {
  get(): any {
    return undefined;
  }
}

export async function runApproverAuthorizationTests() {
  console.log('🔐 Running Approver Authorization Tests (Authz + Separation of Duties)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  /**
   * Suspends a transfer for approval and returns everything needed to settle it.
   * `requesterId` becomes the identity that triggered the action.
   */
  async function suspendTransfer(options?: {
    requesterId?: string;
    authorizer?: ApprovalAuthorizer;
    enforceSeparationOfDuties?: boolean;
  }): Promise<{
    approvals: ApprovalService;
    approvalStore: InMemoryApprovalStore;
    auditSink: InMemoryAuditSink;
    tools: LedgerTools;
    approvalId: string;
  }> {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $5000')
      .callTool('transferMoney', { amount: 5000 })
      .reply('Done.');

    const approvalStore = new InMemoryApprovalStore();
    const auditSink = new InMemoryAuditSink();
    const audit = new AuditTrail([auditSink]);
    const tools = new LedgerTools();

    const localToolProvider = new LocalToolProvider(
      [new HighValuePolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
      audit,
    );

    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );

    const approvals = new ApprovalService(
      approvalStore,
      runner,
      audit,
      options?.authorizer,
      {
        defaultModel: { provider: 'mock', model: 'deterministic' },
        approvals: { enforceSeparationOfDuties: options?.enforceSeparationOfDuties },
      },
    );

    const suspended = await runner.run('banker', {
      sessionId: 'sess_authz',
      message: 'Transfer $5000',
      context: options?.requesterId ? { userId: options.requesterId } : undefined,
    });

    const pending = suspended.toolCalls[0]?.result as { approvalId?: string; status?: string };
    if (!pending?.approvalId) {
      throw new Error('expected the transfer to suspend for approval');
    }
    return { approvals, approvalStore, auditSink, tools, approvalId: pending.approvalId };
  }

  // TEST 1: without an authorizer, behavior is unchanged (backward compatible)
  try {
    const { approvals, approvalId, tools } = await suspendTransfer();
    assert(Boolean(approvalId), 'Test 1a: the transfer suspended for approval');

    await approvals.approve(approvalId, { actor: { userId: 'anyone' } });
    assert(tools.transfers.length === 1, 'Test 1b: with no authorizer registered, any caller can settle (unchanged behavior)');
  } catch (err: unknown) {
    assert(false, 'Test 1: backward compatibility with no authorizer', String(err));
  }

  // TEST 2: the requester identity is recorded on the approval
  try {
    const { approvalStore, approvalId } = await suspendTransfer({ requesterId: 'usr_requester' });
    const stored = await approvalStore.get(approvalId);
    assert(stored?.requestedBy?.userId === 'usr_requester', 'Test 2a: requestedBy captures the triggering identity');

    const { approvalStore: anonStore, approvalId: anonId } = await suspendTransfer();
    const anon = await anonStore.get(anonId);
    assert(anon?.requestedBy === undefined, 'Test 2b: no identity supplied means requestedBy stays undefined, not an empty object');
  } catch (err: unknown) {
    assert(false, 'Test 2: requester identity capture', String(err));
  }

  // TEST 3: an authorizer returning false refuses the settlement
  try {
    const authorizer: ApprovalAuthorizer = {
      canSettle: (_approval, actor) => actor?.roles?.includes('maintainer') ?? false,
    };

    const { approvals, approvalId, tools, approvalStore, auditSink } = await suspendTransfer({ authorizer });

    let refused: unknown;
    try {
      await approvals.approve(approvalId, { actor: { userId: 'usr_intern', roles: ['intern'] } });
    } catch (err) {
      refused = err;
    }

    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 3a: an unauthorized actor gets ApprovalNotAuthorizedError');
    assert(tools.transfers.length === 0, 'Test 3b: the withheld side effect is not applied');

    // The critical property: a refused attempt must NOT consume the approval.
    const stillPending = await approvalStore.get(approvalId);
    assert(stillPending !== null, 'Test 3c: the approval is left pending, not consumed by the refused attempt');

    const denials = auditSink.ofType('approval_settlement_denied');
    assert(denials.length === 1, 'Test 3d: the refused attempt is recorded on the audit trail');
    assert(denials[0]?.actor?.userId === 'usr_intern', 'Test 3e: the audit event records who attempted it');
    assert(denials[0]?.outcome === 'approved', 'Test 3f: the audit event records the intended outcome');

    // An authorized reviewer can still settle the same approval afterwards.
    await approvals.approve(approvalId, { actor: { userId: 'usr_boss', roles: ['maintainer'] } });
    assert(tools.transfers.length === 1, 'Test 3g: an authorized reviewer can still settle it afterwards');
  } catch (err: unknown) {
    assert(false, 'Test 3: authorizer refusal', String(err));
  }

  // TEST 4: an authorizer can supply a refusal reason
  try {
    const authorizer: ApprovalAuthorizer = {
      canSettle: () => ({ allowed: false, reason: 'approver lacks finance_officer entitlement' }),
    };

    const { approvals, approvalId } = await suspendTransfer({ authorizer });

    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await approvals.approve(approvalId, { actor: { userId: 'usr_x' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }

    assert(
      Boolean(refused?.reason.includes('finance_officer')),
      'Test 4a: the authorizer\'s reason is surfaced on the error',
    );
    assert(
      Boolean(refused?.message.includes('finance_officer')),
      'Test 4b: the reason appears in the error message',
    );
  } catch (err: unknown) {
    assert(false, 'Test 4: authorizer refusal reason', String(err));
  }

  // TEST 5: rejection is authorized the same way as approval
  try {
    const authorizer: ApprovalAuthorizer = { canSettle: () => false };
    const { approvals, approvalId, approvalStore } = await suspendTransfer({ authorizer });

    let refused: unknown;
    try {
      await approvals.reject(approvalId, { actor: { userId: 'usr_x' }, reason: 'no' });
    } catch (err) {
      refused = err;
    }

    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 5a: reject() is authorized too, not just approve()');
    assert((await approvalStore.get(approvalId)) !== null, 'Test 5b: a refused rejection also leaves the approval pending');
  } catch (err: unknown) {
    assert(false, 'Test 5: rejection authorization', String(err));
  }

  // TEST 6: separation of duties blocks the requester from self-approving
  try {
    const { approvals, approvalId, tools, approvalStore } = await suspendTransfer({
      requesterId: 'usr_same',
      enforceSeparationOfDuties: true,
    });

    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await approvals.approve(approvalId, { actor: { userId: 'usr_same' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }

    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 6a: the requester cannot also approve when SoD is enforced');
    assert(Boolean(refused?.reason.includes('separation of duties')), 'Test 6b: the refusal identifies the SoD violation');
    assert(tools.transfers.length === 0, 'Test 6c: the side effect is not applied');
    assert((await approvalStore.get(approvalId)) !== null, 'Test 6d: the approval remains pending for someone else to review');

    // A different reviewer succeeds on the same approval.
    await approvals.approve(approvalId, { actor: { userId: 'usr_other' } });
    assert(tools.transfers.length === 1, 'Test 6e: a different approver settles it successfully');
  } catch (err: unknown) {
    assert(false, 'Test 6: separation of duties', String(err));
  }

  // TEST 7: SoD only refuses a *proven* conflict, and is off by default
  try {
    // Same identity on both sides, but SoD not enabled -> allowed.
    const off = await suspendTransfer({ requesterId: 'usr_same' });
    await off.approvals.approve(off.approvalId, { actor: { userId: 'usr_same' } });
    assert(off.tools.transfers.length === 1, 'Test 7a: SoD is off by default, so self-approval is permitted');

    // SoD enabled, but the approver identity is unknown -> cannot prove a conflict.
    const noActor = await suspendTransfer({ requesterId: 'usr_same', enforceSeparationOfDuties: true });
    await noActor.approvals.approve(noActor.approvalId);
    assert(noActor.tools.transfers.length === 1, 'Test 7b: an unidentified approver is not treated as an SoD conflict');

    // SoD enabled, requester unknown -> also cannot prove a conflict.
    const noRequester = await suspendTransfer({ enforceSeparationOfDuties: true });
    await noRequester.approvals.approve(noRequester.approvalId, { actor: { userId: 'usr_any' } });
    assert(noRequester.tools.transfers.length === 1, 'Test 7c: an unidentified requester is not treated as an SoD conflict');

    // Different identities -> allowed.
    const distinct = await suspendTransfer({ requesterId: 'usr_a', enforceSeparationOfDuties: true });
    await distinct.approvals.approve(distinct.approvalId, { actor: { userId: 'usr_b' } });
    assert(distinct.tools.transfers.length === 1, 'Test 7d: distinct requester and approver are permitted');
  } catch (err: unknown) {
    assert(false, 'Test 7: SoD boundary conditions', String(err));
  }

  // TEST 8: an unknown approval id is reported as not-found, not as unauthorized
  try {
    const authorizer: ApprovalAuthorizer = { canSettle: () => true };
    const { approvals } = await suspendTransfer({ authorizer });

    let err: unknown;
    try {
      await approvals.approve('appr_does_not_exist', { actor: { userId: 'usr_x' } });
    } catch (caught) {
      err = caught;
    }

    assert(
      err instanceof Error && err.constructor.name === 'ApprovalNotFoundError',
      'Test 8: an unknown approval id still raises ApprovalNotFoundError on the authorized path',
    );
  } catch (err: unknown) {
    assert(false, 'Test 8: unknown approval id', String(err));
  }

  // TEST 9: the authorizer receives the approval record and the actor
  try {
    let seenApproval: PendingApproval | undefined;
    let seenActor: AuditActor | undefined;

    const authorizer: ApprovalAuthorizer = {
      canSettle: (approval, actor) => {
        seenApproval = approval;
        seenActor = actor;
        return true;
      },
    };

    const { approvals, approvalId } = await suspendTransfer({
      requesterId: 'usr_requester',
      authorizer,
    });
    await approvals.approve(approvalId, { actor: { userId: 'usr_reviewer', roles: ['maintainer'] } });

    assert(seenApproval?.id === approvalId, 'Test 9a: the authorizer receives the approval being settled');
    assert(seenApproval?.toolName === 'transferMoney', 'Test 9b: the approval carries the gated tool name');
    assert(Number(seenApproval?.args?.amount) === 5000, 'Test 9c: the approval carries the withheld arguments');
    assert(seenApproval?.requestedBy?.userId === 'usr_requester', 'Test 9d: the approval carries the requester identity');
    assert(seenActor?.userId === 'usr_reviewer', 'Test 9e: the authorizer receives the settling actor');
  } catch (err: unknown) {
    assert(false, 'Test 9: authorizer inputs', String(err));
  }

  console.log(`\n  📊 Approver Authorization Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Approver Authorization Unit Tests Failed');
  }
}

if (require.main === module) {
  runApproverAuthorizationTests().catch(() => process.exit(1));
}
