import { ModuleRef } from '@nestjs/core';
import {
  APPROVAL_AUTHORIZER,
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
    requesterTenant?: string;
    authorizer?: ApprovalAuthorizer;
    enforceSeparationOfDuties?: boolean;
    enforceTenantIsolation?: boolean;
    requireAuthorizer?: boolean;
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
        approvals: {
          enforceSeparationOfDuties: options?.enforceSeparationOfDuties,
          enforceTenantIsolation: options?.enforceTenantIsolation,
          requireAuthorizer: options?.requireAuthorizer,
        },
      },
    );

    const context =
      options?.requesterId || options?.requesterTenant
        ? { userId: options.requesterId, tenantId: options.requesterTenant }
        : undefined;

    const suspended = await runner.run('banker', {
      sessionId: 'sess_authz',
      message: 'Transfer $5000',
      context,
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

  // TEST 10: tenant isolation blocks cross-tenant settlement
  try {
    const { approvals, approvalId, tools, approvalStore } = await suspendTransfer({
      requesterId: 'usr_a',
      requesterTenant: 'acme',
      enforceTenantIsolation: true,
    });

    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await approvals.approve(approvalId, { actor: { userId: 'usr_b', tenantId: 'evilcorp' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }

    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 10a: an approver from another tenant is refused');
    assert(Boolean(refused?.reason.includes('tenant isolation')), 'Test 10b: the refusal identifies the tenant mismatch');
    assert(tools.transfers.length === 0, 'Test 10c: the side effect is not applied');
    assert((await approvalStore.get(approvalId)) !== null, 'Test 10d: the approval remains pending');

    // An approver in the right tenant succeeds.
    await approvals.approve(approvalId, { actor: { userId: 'usr_b', tenantId: 'acme' } });
    assert(tools.transfers.length === 1, 'Test 10e: an approver in the approval\'s tenant settles it');
  } catch (err: unknown) {
    assert(false, 'Test 10: tenant isolation', String(err));
  }

  // TEST 11: tenant isolation fails closed on any unproven tenant, and is off by default
  try {
    const noActorTenant = await suspendTransfer({ requesterTenant: 'acme', enforceTenantIsolation: true });
    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await noActorTenant.approvals.approve(noActorTenant.approvalId, { actor: { userId: 'usr_x' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }
    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 11a: an approver with no tenant is refused when isolation is enforced');
    assert(Boolean(refused?.reason.includes('no tenant')), 'Test 11b: the refusal says the approver supplied no tenant');

    // An untenanted approval must not become settleable from any tenant.
    const untenanted = await suspendTransfer({ requesterId: 'usr_a', enforceTenantIsolation: true });
    let untenantedRefusal: ApprovalNotAuthorizedError | undefined;
    try {
      await untenanted.approvals.approve(untenanted.approvalId, { actor: { userId: 'usr_b', tenantId: 'anything' } });
    } catch (err) {
      untenantedRefusal = err as ApprovalNotAuthorizedError;
    }
    assert(
      untenantedRefusal instanceof ApprovalNotAuthorizedError,
      'Test 11c: an approval carrying no tenant is refused under isolation rather than settleable from any tenant',
    );
    assert(untenanted.tools.transfers.length === 0, 'Test 11d: the untenanted approval was not settled');

    const off = await suspendTransfer({ requesterTenant: 'acme' });
    await off.approvals.approve(off.approvalId, { actor: { userId: 'usr_x', tenantId: 'other' } });
    assert(off.tools.transfers.length === 1, 'Test 11e: tenant isolation is off by default');
  } catch (err: unknown) {
    assert(false, 'Test 11: tenant isolation boundaries', String(err));
  }

  // TEST 12: SoD is tenant-scoped but only a *proven* different tenant clears a conflict
  try {
    // Same userId, provably different tenant: a different person, so not a conflict.
    const crossTenant = await suspendTransfer({
      requesterId: 'admin',
      requesterTenant: 'tenant_a',
      enforceSeparationOfDuties: true,
    });
    await crossTenant.approvals.approve(crossTenant.approvalId, { actor: { userId: 'admin', tenantId: 'tenant_b' } });
    assert(crossTenant.tools.transfers.length === 1, 'Test 12a: an identical userId in a provably different tenant is not an SoD conflict');

    // Same userId, same tenant: a real conflict.
    const sameTenant = await suspendTransfer({
      requesterId: 'admin',
      requesterTenant: 'tenant_a',
      enforceSeparationOfDuties: true,
    });
    let refused: unknown;
    try {
      await sameTenant.approvals.approve(sameTenant.approvalId, { actor: { userId: 'admin', tenantId: 'tenant_a' } });
    } catch (err) {
      refused = err;
    }
    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 12b: the same userId in the same tenant is refused');

    // Approval has no tenant, approver supplies one: the tenants are NOT provably
    // different, so a matching userId must still be refused (previously fail-open).
    const requesterNoTenant = await suspendTransfer({
      requesterId: 'admin',
      enforceSeparationOfDuties: true,
    });
    let noTenantRefusal: unknown;
    try {
      await requesterNoTenant.approvals.approve(requesterNoTenant.approvalId, {
        actor: { userId: 'admin', tenantId: 'tenant_a' },
      });
    } catch (err) {
      noTenantRefusal = err;
    }
    assert(
      noTenantRefusal instanceof ApprovalNotAuthorizedError,
      'Test 12c: an untenanted approval with a matching userId is still an SoD conflict, not fail-open',
    );

    // Reverse: approval is tenant-scoped, approver omits the tenant.
    const approverNoTenant = await suspendTransfer({
      requesterId: 'admin',
      requesterTenant: 'tenant_a',
      enforceSeparationOfDuties: true,
    });
    let approverRefusal: unknown;
    try {
      await approverNoTenant.approvals.approve(approverNoTenant.approvalId, { actor: { userId: 'admin' } });
    } catch (err) {
      approverRefusal = err;
    }
    assert(
      approverRefusal instanceof ApprovalNotAuthorizedError,
      'Test 12d: omitting the approver tenant does not defeat SoD on a tenant-scoped approval',
    );
  } catch (err: unknown) {
    assert(false, 'Test 12: tenant-scoped separation of duties', String(err));
  }

  // TEST 14: the authorizer is registerable through AgenticModule.forRoot
  try {
    const { AgenticModule } = await import('../src');
    const authorizer: ApprovalAuthorizer = { canSettle: () => false };

    const dynamicModule = AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'deterministic' },
      approvalAuthorizer: authorizer,
    });

    const registered = (dynamicModule.providers ?? []).some(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === APPROVAL_AUTHORIZER &&
        'useValue' in provider &&
        provider.useValue === authorizer,
    );

    assert(
      registered,
      'Test 14a: forRoot({ approvalAuthorizer }) registers the APPROVAL_AUTHORIZER token inside AgenticModule',
    );

    // Without the option the token stays unprovided, so behavior is unchanged.
    const withoutAuthorizer = AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'deterministic' },
    });
    const absent = (withoutAuthorizer.providers ?? []).every(
      (provider) =>
        !(typeof provider === 'object' && provider !== null && 'provide' in provider && provider.provide === APPROVAL_AUTHORIZER),
    );
    assert(absent, 'Test 14b: the token is left unprovided when no authorizer is configured');
  } catch (err: unknown) {
    assert(false, 'Test 14: authorizer registration through forRoot', String(err));
  }

  // TEST 13: requireAuthorizer fails closed when no authorizer is registered
  try {
    const { approvals, approvalId, tools, approvalStore } = await suspendTransfer({
      requireAuthorizer: true,
    });

    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await approvals.approve(approvalId, { actor: { userId: 'usr_x' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }

    assert(refused instanceof ApprovalNotAuthorizedError, 'Test 13a: requireAuthorizer refuses settlement with no authorizer registered');
    assert(Boolean(refused?.reason.includes('requireAuthorizer')), 'Test 13b: the refusal names the enabled option');
    assert(tools.transfers.length === 0, 'Test 13c: the side effect is not applied');
    assert((await approvalStore.get(approvalId)) !== null, 'Test 13d: the approval remains pending');

    // With an authorizer registered, the same strict mode permits it.
    const withAuthorizer = await suspendTransfer({
      requireAuthorizer: true,
      authorizer: { canSettle: () => true },
    });
    await withAuthorizer.approvals.approve(withAuthorizer.approvalId, { actor: { userId: 'usr_x' } });
    assert(withAuthorizer.tools.transfers.length === 1, 'Test 13e: strict mode passes once an authorizer is registered');
  } catch (err: unknown) {
    assert(false, 'Test 13: requireAuthorizer strict mode', String(err));
  }

  // TEST 15: the authorizer can be registered DI-natively, not only as an instance
  try {
    const { AgenticModule } = await import('../src');
    const base = { defaultModel: { provider: 'mock', model: 'deterministic' } } as const;

    function authorizerProvider(dynamicModule: { providers?: unknown[] }) {
      return (dynamicModule.providers ?? []).find(
        (provider): provider is Record<string, unknown> =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          (provider as Record<string, unknown>).provide === APPROVAL_AUTHORIZER,
      );
    }

    class RoleAuthorizer implements ApprovalAuthorizer {
      canSettle() {
        return true;
      }
    }

    // useClass: constructed by Nest, so it can inject its own dependencies.
    const viaClass = authorizerProvider(
      AgenticModule.forRoot({ ...base, approvalAuthorizer: { useClass: RoleAuthorizer } }),
    );
    assert(viaClass?.useClass === RoleAuthorizer, 'Test 15a: { useClass } registers a class provider Nest can construct');

    // useFactory with injected tokens.
    const factory = () => new RoleAuthorizer();
    const viaFactory = authorizerProvider(
      AgenticModule.forRoot({
        ...base,
        approvalAuthorizer: { useFactory: factory, inject: [APPROVAL_AUTHORIZER] },
      }),
    );
    assert(viaFactory?.useFactory === factory, 'Test 15b: { useFactory } registers a factory provider');
    assert(
      Array.isArray(viaFactory?.inject) && (viaFactory.inject as unknown[]).length === 1,
      'Test 15c: the factory inject list is forwarded',
    );

    // A bare instance still works, for an authorizer needing nothing injected.
    const instance = new RoleAuthorizer();
    const viaValue = authorizerProvider(
      AgenticModule.forRoot({ ...base, approvalAuthorizer: instance }),
    );
    assert(viaValue?.useValue === instance, 'Test 15d: a bare instance is still registered as a value provider');
  } catch (err: unknown) {
    assert(false, 'Test 15: DI-native authorizer registration', String(err));
  }

  // TEST 16: a record replaced between the authorization read and the claim is refused
  try {
    const approved: PendingApproval = {
      id: 'appr_toctou',
      agentName: 'banker',
      toolName: 'transferMoney',
      args: { amount: 5000 },
      context: { sessionId: 's', traceId: 't', security: { userId: 'usr_a' } },
      reason: 'needs review',
      createdAt: new Date(),
      requestedBy: { userId: 'usr_a' },
    };

    let settleCalls = 0;
    // A store that mutates the record in place: `get()` returns the version the
    // authorizer sees, `claim()` returns a different one.
    const racingStore = {
      async save() {},
      async get() {
        return approved;
      },
      async delete() {},
      async claim() {
        return { ...approved, args: { amount: 999_999 } };
      },
    };
    const stubRunner = {
      async settleApproval() {
        settleCalls += 1;
        return { output: 'settled', toolCalls: [] };
      },
    };

    const service = new ApprovalService(
      racingStore,
      stubRunner as unknown as AgentRunner,
      undefined,
      { canSettle: () => true },
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
    );

    let refused: ApprovalNotAuthorizedError | undefined;
    try {
      await service.approve('appr_toctou', { actor: { userId: 'usr_b' } });
    } catch (err) {
      refused = err as ApprovalNotAuthorizedError;
    }

    assert(
      refused instanceof ApprovalNotAuthorizedError,
      'Test 16a: a record altered between the authorization read and the claim is refused',
    );
    assert(
      Boolean(refused?.reason.includes('changed between authorization and claim')),
      'Test 16b: the refusal explains the stale-authorization cause',
    );
    assert(settleCalls === 0, 'Test 16c: the withheld tool is never settled against the swapped record');

    // An unchanged record still settles normally through the same path.
    const stableStore = { ...racingStore, async claim() { return approved; } };
    let stableSettles = 0;
    const stableService = new ApprovalService(
      stableStore,
      { async settleApproval() { stableSettles += 1; return { output: 'ok', toolCalls: [] }; } } as unknown as AgentRunner,
      undefined,
      { canSettle: () => true },
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
    );
    await stableService.approve('appr_toctou', { actor: { userId: 'usr_b' } });
    assert(stableSettles === 1, 'Test 16d: an unchanged record is unaffected by the guard');
  } catch (err: unknown) {
    assert(false, 'Test 16: stale-authorization guard', String(err));
  }

  // TEST 17: console audit output cannot be forged through actor/reason strings
  try {
    const { ConsoleAuditSink } = await import('../src');
    const lines: string[] = [];
    const sink = new ConsoleAuditSink({ logger: (message) => lines.push(message) });

    sink.record({
      type: 'approval_settlement_denied',
      at: new Date('2026-01-01T00:00:00.000Z'),
      sessionId: 'sess_x',
      traceId: 'trace_x',
      approvalId: 'appr_x',
      agentName: 'banker',
      toolName: 'transferMoney',
      outcome: 'approved',
      reason: 'refused\n[audit] approval_settled forged line',
      actor: { userId: 'usr\nevil' },
    });

    assert(lines.length === 1, 'Test 17a: one event produces exactly one log line');
    assert(!lines[0].includes('\n'), 'Test 17b: newlines in the reason and actor cannot forge extra log lines');
    assert(lines[0].includes('forged line'), 'Test 17c: the text is flattened rather than dropped');
  } catch (err: unknown) {
    assert(false, 'Test 17: console audit log-injection safety', String(err));
  }

  console.log(`\n  📊 Approver Authorization Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Approver Authorization Unit Tests Failed');
  }
}

if (require.main === module) {
  runApproverAuthorizationTests().catch(() => process.exit(1));
}
