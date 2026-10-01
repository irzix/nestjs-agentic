import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  ApprovalExpiredError,
  ApprovalNotAuthorizedError,
  ApprovalNotFoundError,
  ApprovalService,
  ApprovalSignaturesUnsupportedError,
  AuditTrail,
  ExecutionCancelledError,
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
  ApprovalSignature,
  ApprovalSignatureResult,
  ApprovalStore,
  PendingApproval,
  PolicyResult,
  ToolExecutionResult,
  ToolPolicy,
} from '../src';

/** Requires `required` approvers for any transfer. */
class DualControlPolicy implements ToolPolicy {
  // `unknown` so the class satisfies @UsePolicies' constructor signature.
  constructor(private readonly required?: unknown) {}

  async evaluate(): Promise<PolicyResult> {
    return {
      decision: 'require_approval',
      reason: 'Wire transfers need dual control.',
      requiredApprovals: this.required as number | undefined,
    };
  }
}

@ToolSet({ name: 'treasury' })
class TreasuryTools {
  readonly wires: number[] = [];

  @Tool({ name: 'sendWire', description: 'Send a wire transfer' })
  @UsePolicies(DualControlPolicy)
  async sendWire(
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Context() _ctx: AgentContext,
  ) {
    this.wires.push(amount);
    return { wireId: `wire_${this.wires.length}`, amount };
  }
}

@Agent({ name: 'treasurer', description: 'Moves money' })
class TreasurerAgent implements AgentProvider {
  constructor(private readonly tools: TreasuryTools) {}

  define(): AgentConfig {
    return { instructions: 'Send wires carefully.', tools: [this.tools] };
  }
}

class MockModuleRef {
  get(): undefined {
    return undefined;
  }
}

/** Delegates to an in-memory store but hides addSignature, like a store that predates dual control. */
class LegacyApprovalStore implements ApprovalStore {
  readonly inner = new InMemoryApprovalStore();
  save(approval: PendingApproval) {
    return this.inner.save(approval);
  }
  get(id: string) {
    return this.inner.get(id);
  }
  delete(id: string) {
    return this.inner.delete(id);
  }
  claim(id: string) {
    return this.inner.claim(id);
  }
}

/** Returns a different record than the one authorized when the threshold is met. */
class TamperingApprovalStore extends InMemoryApprovalStore {
  async addSignature(id: string, signature: ApprovalSignature): Promise<ApprovalSignatureResult | null> {
    const result = await super.addSignature(id, signature);
    if (result?.status === 'complete') {
      return { ...result, approval: { ...result.approval, args: { amount: 9_999_999 } } };
    }
    return result;
  }
}

/** Reports an expired record on read, while the stored one is still valid, as if the clock moved back. */
class ClockSkewStore extends InMemoryApprovalStore {
  async get(id: string) {
    const record = await super.get(id);
    return record ? { ...record, expiresAt: new Date(Date.now() - 1000) } : null;
  }
}

/** Aborts the caller's signal while a store write is in flight. */
class AbortingStore extends InMemoryApprovalStore {
  controller?: AbortController;
  async addSignature(id: string, signature: ApprovalSignature) {
    const result = await super.addSignature(id, signature);
    this.controller?.abort();
    return result;
  }
  async claim(id: string) {
    const result = await super.claim(id);
    this.controller?.abort();
    return result;
  }
}

/** Requires one approval for every call, from a module-wide policy. */
class GlobalReviewPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'require_approval', reason: 'Every wire is reviewed.', ttlSeconds: 3600 };
  }
}

/** Refuses wires to sanctioned destinations. */
class SanctionsPolicy implements ToolPolicy {
  async evaluate(_ctx: AgentContext, _tool: string, args: Record<string, unknown>): Promise<PolicyResult> {
    return args.amount === 66_666 ? { decision: 'deny', reason: 'Sanctioned destination.' } : { decision: 'allow' };
  }
}

function isPending(result: unknown): result is Extract<ToolExecutionResult, { status: 'pending_approval' }> {
  return (result as { status?: string })?.status === 'pending_approval';
}

export async function runDualControlTests() {
  console.log('🔏 Running Dual Control (N-of-M approvals) Tests...\n');

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

  async function expectError(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
      return undefined;
    } catch (err: unknown) {
      return err;
    }
  }

  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  /** Suspends a $50,000 wire behind a dual-control approval. */
  async function suspendWire(options: {
    required?: number;
    store?: ApprovalStore;
    authorizer?: ApprovalAuthorizer;
    enforceSeparationOfDuties?: boolean;
    approvalTtlSeconds?: number;
    defaultPolicies?: Array<new (...args: unknown[]) => ToolPolicy>;
    amount?: number;
  } = {}) {
    const amount = options.amount ?? 50_000;
    const model = new MockModelAdapter();
    model.whenAsked(`Wire $${amount}`).callTool('sendWire', { amount }).reply('Wire sent.');

    const approvalStore = options.store ?? new InMemoryApprovalStore();
    const auditSink = new InMemoryAuditSink();
    const audit = new AuditTrail([auditSink]);
    const tools = new TreasuryTools();
    const moduleOptions = {
      defaultModel: { provider: 'mock', model: 'deterministic' },
      approvalTtlSeconds: options.approvalTtlSeconds,
      approvals: { enforceSeparationOfDuties: options.enforceSeparationOfDuties },
      defaultPolicies: options.defaultPolicies,
    };

    const localToolProvider = new LocalToolProvider(
      [new DualControlPolicy('required' in options ? options.required : 2), new GlobalReviewPolicy(), new SanctionsPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
      audit,
      undefined,
      moduleOptions,
    );
    const runner = new AgentRunner(
      [new TreasurerAgent(tools)],
      undefined,
      moduleOptions,
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner, audit, options.authorizer, moduleOptions);

    const suspended = await runner.run('treasurer', {
      sessionId: 'sess_wire',
      message: `Wire $${amount}`,
      context: { userId: 'usr_requester', tenantId: 'bank' },
    });
    const toolResult = suspended.toolCalls[0]?.result as ToolExecutionResult;
    const approvalId = isPending(toolResult) ? toolResult.approvalId : '';
    return { approvals, approvalStore, auditSink, tools, toolResult, approvalId };
  }

  const alice = { userId: 'alice', tenantId: 'bank', roles: ['treasury'] };
  const bob = { userId: 'bob', tenantId: 'bank', roles: ['treasury'] };
  const carol = { userId: 'carol', tenantId: 'bank', roles: ['treasury'] };

  // TEST 1: the threshold is persisted and the tool waits for N distinct signatures
  try {
    const { approvals, approvalStore, auditSink, tools, toolResult, approvalId } = await suspendWire();

    assert(
      isPending(toolResult) && toolResult.requiredApprovals === 2 && toolResult.signatures === 0,
      'Test 1a: The suspended call reports 0 of 2 approvals',
      JSON.stringify(toolResult),
    );
    assert((await approvalStore.get(approvalId))?.requiredApprovals === 2, 'Test 1b: requiredApprovals is persisted');
    assert(
      auditSink.ofType('approval_requested')[0]?.requiredApprovals === 2,
      'Test 1c: The approval_requested audit event records the threshold',
    );

    const first = await approvals.approve(approvalId, { actor: alice });
    assert(
      isPending(first) && first.signatures === 1 && first.requiredApprovals === 2,
      'Test 1d: The first signature returns pending_approval, 1 of 2',
      JSON.stringify(first),
    );
    assert(tools.wires.length === 0, 'Test 1e: The tool does not run on the first signature');

    const repeat = await expectError(approvals.approve(approvalId, { actor: alice }));
    assert(
      repeat instanceof ApprovalNotAuthorizedError && repeat.reason.includes('already signed'),
      'Test 1f: A repeated signature from the same identity is refused',
      String(repeat),
    );
    assert(
      (await approvalStore.get(approvalId))?.signatures?.length === 1,
      'Test 1g: The repeated signature is not counted',
    );
    assert(
      auditSink.ofType('approval_settlement_denied').some((e) => e.reason.includes('already signed')),
      'Test 1h: The refused duplicate is on the audit trail',
    );

    const final = await approvals.approve(approvalId, { actor: bob });
    assert(tools.wires.length === 1, 'Test 1i: The tool runs once the second distinct approver signs');
    assert(
      !isPending(final) && (final as { output?: string }).output === 'Wire sent.',
      'Test 1j: The final signature resumes the turn',
      JSON.stringify(final),
    );
    assert((await approvalStore.get(approvalId)) === null, 'Test 1k: The settled approval is consumed');

    const signed = auditSink.ofType('approval_signed');
    assert(
      signed.length === 2 &&
        signed[0].actor.userId === 'alice' &&
        signed[0].signatures === 1 &&
        signed[1].actor.userId === 'bob' &&
        signed[1].signatures === 2 &&
        signed.every((e) => e.requiredApprovals === 2),
      'Test 1l: Every counted signature is audited with its progression',
      JSON.stringify(signed.map((e) => [e.actor.userId, e.signatures])),
    );
    const settled = auditSink.ofType('approval_settled')[0];
    assert(
      settled?.outcome === 'approved' &&
        settled.actor?.userId === 'bob' &&
        settled.signatures?.map((a) => a.userId).join(',') === 'alice,bob',
      'Test 1m: approval_settled names every approver',
      JSON.stringify(settled?.signatures),
    );

    const late = await expectError(approvals.approve(approvalId, { actor: carol }));
    assert(late instanceof ApprovalNotFoundError, 'Test 1n: A signature after settlement finds nothing to sign');
  } catch (err: unknown) {
    assert(false, 'Test 1: Two-of-N approval flow', String(err));
  }

  // TEST 2: unidentified approvers cannot sign
  try {
    const { approvals, approvalStore, approvalId } = await suspendWire();
    const anonymous = await expectError(approvals.approve(approvalId));
    const labelOnly = await expectError(approvals.approve(approvalId, { actor: { label: 'slack-bot' } }));
    assert(
      anonymous instanceof ApprovalNotAuthorizedError && labelOnly instanceof ApprovalNotAuthorizedError,
      'Test 2a: A signature without actor.userId is refused',
    );
    assert(
      (await approvalStore.get(approvalId))?.signatures === undefined,
      'Test 2b: Refused signatures leave the approval untouched',
    );
  } catch (err: unknown) {
    assert(false, 'Test 2: Unidentified approvers', String(err));
  }

  // TEST 3: each signature passes separation of duties and the authorizer
  try {
    const { approvals, tools, approvalId } = await suspendWire({
      enforceSeparationOfDuties: true,
      authorizer: { canSettle: (_approval, actor) => actor?.userId !== 'eve' },
    });
    const selfApproval = await expectError(approvals.approve(approvalId, { actor: { userId: 'usr_requester', tenantId: 'bank' } }));
    assert(
      selfApproval instanceof ApprovalNotAuthorizedError && selfApproval.reason.includes('separation of duties'),
      'Test 3a: The requester cannot sign their own action',
      String(selfApproval),
    );
    const refused = await expectError(approvals.approve(approvalId, { actor: { userId: 'eve', tenantId: 'bank' } }));
    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 3b: The authorizer is consulted for every signature');

    await approvals.approve(approvalId, { actor: alice });
    await approvals.approve(approvalId, { actor: bob });
    assert(tools.wires.length === 1, 'Test 3c: Authorized approvers still complete the approval');
  } catch (err: unknown) {
    assert(false, 'Test 3: Governance per signature', String(err));
  }

  // TEST 4: a single authorized rejection vetoes
  try {
    const { approvals, auditSink, tools, approvalId } = await suspendWire({ required: 3 });
    await approvals.approve(approvalId, { actor: alice });
    const result = await approvals.reject(approvalId, { actor: bob, reason: 'Beneficiary not verified.' });
    assert(tools.wires.length === 0, 'Test 4a: The tool never runs after a veto');
    assert(!isPending(result), 'Test 4b: The rejection settles the approval and resumes the turn');
    const settled = auditSink.ofType('approval_settled')[0];
    assert(
      settled?.outcome === 'rejected' && settled.signatures?.map((a) => a.userId).join(',') === 'alice',
      'Test 4c: The veto is audited with the signatures collected before it',
      JSON.stringify(settled),
    );
  } catch (err: unknown) {
    assert(false, 'Test 4: Rejection veto', String(err));
  }

  // TEST 5: concurrent signatures run the tool exactly once
  try {
    const { approvals, tools, approvalId } = await suspendWire({ required: 3 });
    const outcomes = await Promise.allSettled(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((userId) => approvals.approve(approvalId, { actor: { userId } })),
    );
    const settledCount = outcomes.filter((o) => o.status === 'fulfilled' && !isPending(o.value)).length;
    assert(tools.wires.length === 1, 'Test 5a: Six concurrent approvers execute the tool exactly once', String(tools.wires.length));
    assert(settledCount === 1, 'Test 5b: Exactly one approver receives the settled result', String(settledCount));
  } catch (err: unknown) {
    assert(false, 'Test 5: Concurrent signatures', String(err));
  }

  // TEST 6: stores without addSignature fail closed
  try {
    const legacy = new LegacyApprovalStore();
    const { tools, toolResult, approvalId } = await suspendWire({ store: legacy });
    assert(
      (toolResult as { status?: string }).status === 'denied' &&
        (toolResult as { reason?: string }).reason!.includes('addSignature') &&
        approvalId === '' &&
        tools.wires.length === 0,
      'Test 6a: A dual-control decision on a store without addSignature is denied, not downgraded',
      JSON.stringify(toolResult),
    );

    const single = await suspendWire({ store: new LegacyApprovalStore(), required: undefined });
    await single.approvals.approve(single.approvalId, { actor: alice });
    assert(single.tools.wires.length === 1, 'Test 6b: The same store keeps working for single-approver approvals');

    const seeded = await suspendWire({ store: new LegacyApprovalStore(), required: 1 });
    const record = await seeded.approvalStore.get(seeded.approvalId);
    await seeded.approvalStore.save({ ...record!, requiredApprovals: 2 });
    const unsupported = await expectError(seeded.approvals.approve(seeded.approvalId, { actor: alice }));
    assert(
      unsupported instanceof ApprovalSignaturesUnsupportedError && seeded.tools.wires.length === 0,
      'Test 6c: Settling a multi-approver record through such a store throws instead of settling it',
      String(unsupported),
    );
  } catch (err: unknown) {
    assert(false, 'Test 6: Stores without addSignature', String(err));
  }

  // TEST 7: invalid thresholds are denied
  try {
    for (const required of [0, 1.5, -2]) {
      const { toolResult, tools } = await suspendWire({ required });
      assert(
        (toolResult as { status?: string }).status === 'denied' && tools.wires.length === 0,
        `Test 7: requiredApprovals ${required} is denied as a misconfiguration`,
        JSON.stringify(toolResult),
      );
    }
    const explicitOne = await suspendWire({ required: 1 });
    await explicitOne.approvals.approve(explicitOne.approvalId);
    assert(explicitOne.tools.wires.length === 1, 'Test 7d: requiredApprovals 1 behaves like a normal approval');
  } catch (err: unknown) {
    assert(false, 'Test 7: Threshold validation', String(err));
  }

  // TEST 8: an expired dual-control approval is consumed and reported
  try {
    const { approvals, approvalStore, auditSink, tools, approvalId } = await suspendWire({ approvalTtlSeconds: 60 });
    await approvals.approve(approvalId, { actor: alice });
    const record = await approvalStore.get(approvalId);
    await approvalStore.save({ ...record!, expiresAt: new Date(Date.now() - 1000) });

    const expired = await expectError(approvals.approve(approvalId, { actor: bob }));
    assert(expired instanceof ApprovalExpiredError, 'Test 8a: Signing an expired approval throws ApprovalExpiredError', String(expired));
    assert(tools.wires.length === 0 && (await approvalStore.get(approvalId)) === null, 'Test 8b: The expired approval is consumed, not executed');
    assert(auditSink.ofType('approval_expired').length === 1, 'Test 8c: The expiry is audited');
  } catch (err: unknown) {
    assert(false, 'Test 8: Expiry', String(err));
  }

  // TEST 9: a record that changed before the final signature is refused and restored
  try {
    const store = new TamperingApprovalStore();
    const { approvals, tools, approvalId } = await suspendWire({ store });
    await approvals.approve(approvalId, { actor: alice });
    const tampered = await expectError(approvals.approve(approvalId, { actor: bob }));
    assert(
      tampered instanceof ApprovalNotAuthorizedError && tools.wires.length === 0,
      'Test 9a: A changed record is not settled by the final signature',
      String(tampered),
    );
    const restored = await store.get(approvalId);
    assert(
      restored !== null && (restored.signatures ?? []).length === 0,
      'Test 9b: The approval is restored without signatures given for another version of it',
      JSON.stringify(restored?.signatures),
    );
  } catch (err: unknown) {
    assert(false, 'Test 9: Fingerprint check on completion', String(err));
  }

  // TEST 10: every policy is evaluated, and the strictest approval terms win
  try {
    const layered = await suspendWire({ defaultPolicies: [GlobalReviewPolicy, SanctionsPolicy] });
    const stored = await layered.approvalStore.get(layered.approvalId);
    assert(
      isPending(layered.toolResult) && layered.toolResult.requiredApprovals === 2 && stored?.requiredApprovals === 2,
      'Test 10a: An earlier single-approver policy does not downgrade a later dual-control one',
      JSON.stringify(layered.toolResult),
    );
    assert(
      stored?.expiresAt !== undefined && stored.expiresAt.getTime() - stored.createdAt.getTime() === 3_600_000,
      'Test 10b: The shortest policy lifetime applies',
    );
    assert(
      layered.auditSink.ofType('tool_policy_decision').filter((e) => e.decision === 'require_approval').length === 2,
      'Test 10c: Each policy that required approval is on the audit trail',
    );

    const inherited = await suspendWire({ defaultPolicies: [GlobalReviewPolicy], approvalTtlSeconds: 60 });
    const inheritedRecord = await inherited.approvalStore.get(inherited.approvalId);
    assert(
      inheritedRecord?.expiresAt !== undefined &&
        inheritedRecord.expiresAt.getTime() - inheritedRecord.createdAt.getTime() === 60_000,
      "Test 10e: A policy inheriting the module's shorter default lifetime is not outlived by another policy's explicit one",
      String(inheritedRecord?.expiresAt && inheritedRecord.expiresAt.getTime() - inheritedRecord.createdAt.getTime()),
    );

    const sanctioned = await suspendWire({ defaultPolicies: [GlobalReviewPolicy, SanctionsPolicy], amount: 66_666 });
    assert(
      (sanctioned.toolResult as { status?: string }).status === 'denied' && sanctioned.approvalId === '',
      'Test 10d: A later deny wins over an earlier approval requirement',
      JSON.stringify(sanctioned.toolResult),
    );
  } catch (err: unknown) {
    assert(false, 'Test 10: Policy combination', String(err));
  }

  // TEST 11: no settlement path runs the tool with too few signatures
  try {
    const store = new ClockSkewStore();
    const { approvals, tools, approvalId } = await suspendWire({ store, approvalTtlSeconds: 600 });
    const err = await expectError(approvals.approve(approvalId, { actor: alice }));
    assert(
      err instanceof ApprovalNotAuthorizedError && err.reason.includes('requires 2 approvers') && tools.wires.length === 0,
      'Test 11a: An approval read as expired but claimed valid is refused, not run with one signature',
      String(err),
    );
    assert((await store.claim(approvalId)) !== null, 'Test 11b: The refused approval is put back');
  } catch (err: unknown) {
    assert(false, 'Test 11: Threshold guard', String(err));
  }

  // TEST 12: signatures only count toward the version they were given for
  try {
    const { approvals, approvalStore, auditSink, tools, approvalId } = await suspendWire();
    await approvals.approve(approvalId, { actor: alice });
    const signedByAlice = await approvalStore.get(approvalId);
    await approvalStore.save({ ...signedByAlice!, args: { amount: 9_000_000 } });

    const err = await expectError(approvals.approve(approvalId, { actor: bob }));
    assert(
      err instanceof ApprovalNotAuthorizedError && err.reason.includes('changed after some approvers signed') && tools.wires.length === 0,
      'Test 12a: A signature given before the record changed cannot complete it',
      String(err),
    );
    assert((await approvalStore.get(approvalId))?.signatures?.length === 0, 'Test 12b: The stale signature is dropped when the approval is put back');
    assert(
      auditSink.ofType('approval_signed').every((e) => e.actor.userId === 'alice'),
      'Test 12c: The refused final signature is not audited as signed',
    );

    await approvals.approve(approvalId, { actor: bob });
    await approvals.approve(approvalId, { actor: carol });
    assert(tools.wires.length === 1, 'Test 12d: Fresh signatures on the current version complete it');
  } catch (err: unknown) {
    assert(false, 'Test 12: Version binding', String(err));
  }

  // TEST 13: cancelling during a store write never loses the approval
  try {
    const store = new AbortingStore();
    const { approvals, tools, approvalId } = await suspendWire({ store });
    await approvals.approve(approvalId, { actor: alice });

    store.controller = new AbortController();
    const cancelled = await expectError(approvals.approve(approvalId, { actor: bob, signal: store.controller.signal }));
    store.controller = undefined;
    assert(cancelled instanceof ExecutionCancelledError && tools.wires.length === 0, 'Test 13a: Cancelling the final signature does not run the tool');
    const kept = await store.get(approvalId);
    assert(
      kept?.signatures?.map((sig) => sig.actor.userId).join(',') === 'alice',
      'Test 13b: The approval is put back without the cancelled signature',
      JSON.stringify(kept?.signatures),
    );
    await approvals.approve(approvalId, { actor: bob });
    assert(tools.wires.length === 1, 'Test 13c: The same approver can sign again and complete it');

    const single = await suspendWire({ store: new AbortingStore(), required: 1 });
    const singleStore = single.approvalStore as AbortingStore;
    singleStore.controller = new AbortController();
    const cancelledClaim = await expectError(single.approvals.approve(single.approvalId, { signal: singleStore.controller.signal }));
    singleStore.controller = undefined;
    assert(
      cancelledClaim instanceof ExecutionCancelledError && (await singleStore.get(single.approvalId)) !== null,
      'Test 13d: A claim cancelled in flight is put back, not consumed',
    );
  } catch (err: unknown) {
    assert(false, 'Test 13: Cancellation', String(err));
  }

  console.log(`\n  📊 Dual Control Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Dual control tests failed');
  }
}
