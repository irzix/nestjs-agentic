import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgentResult,
  AgentRunner,
  AgenticModule,
  ApprovalExpiredError,
  ApprovalNotFoundError,
  ApprovalService,
  GenericPostgresClient,
  GenericRedisClient,
  InFlightCheckpoint,
  InMemoryAgentObserver,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  Param,
  PostgresApprovalStore,
  PostgresSessionStore,
  PostgresStateStore,
  RedisApprovalStore,
  RedisSessionStore,
  RedisStateStore,
  Tool,
  ToolExecutionResult,
  ToolPolicy,
  ToolSet,
  UsePolicies,
} from '../src';
import type { AgentConfig, AgentContext, AgentProvider, PolicyResult } from '../src';
import { createFakePostgres } from './postgres-stores.spec';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function isAgentResult(res: AgentResult | ToolExecutionResult): res is AgentResult {
  return typeof res === 'object' && res !== null && 'output' in res;
}

/**
 * In-memory fake Redis client storing string values in a Map,
 * supporting atomic `getdel`, `set` with TTL, `del`, and `keys`.
 */
function createSharedFakeRedis() {
  const storage = new Map<string, string>();
  const ttls = new Map<string, number>();

  const client: GenericRedisClient = {
    async get(key: string) {
      const exp = ttls.get(key);
      if (exp !== undefined && Date.now() > exp) {
        storage.delete(key);
        ttls.delete(key);
        return null;
      }
      return storage.get(key) ?? null;
    },
    async set(key: string, value: string, mode?: string, duration?: number) {
      storage.set(key, value);
      if (mode === 'EX' && duration !== undefined) {
        ttls.set(key, Date.now() + duration * 1000);
      } else if (mode === 'PX' && duration !== undefined) {
        ttls.set(key, Date.now() + duration);
      } else {
        ttls.delete(key);
      }
      return 'OK';
    },
    async del(key: string) {
      ttls.delete(key);
      return storage.delete(key) ? 1 : 0;
    },
    async keys(pattern: string) {
      const prefix = pattern.replace(/\*$/, '');
      return [...storage.keys()].filter((key) => key.startsWith(prefix));
    },
    async getdel(key: string) {
      const exp = ttls.get(key);
      if (exp !== undefined && Date.now() > exp) {
        storage.delete(key);
        ttls.delete(key);
        return null;
      }
      const val = storage.get(key) ?? null;
      storage.delete(key);
      ttls.delete(key);
      return val;
    },
  };

  return { client, storage, ttls };
}

// -----------------------------------------------------------------------------
// Policies, ToolSets, and Agents for Integration Testing
// -----------------------------------------------------------------------------

class RequireManagerApprovalPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const environment = args.environment as string | undefined;
    if (environment === 'production') {
      return {
        decision: 'require_approval',
        reason: 'Production deployments require human managerial approval.',
        ttlSeconds: (args.ttlSeconds as number | undefined) ?? 3600,
      };
    }
    return { decision: 'allow' };
  }
}

@ToolSet({ name: 'devops' })
class DevOpsToolSet {
  readonly executedDeployments: Array<{ releaseTag: string; environment: string }> = [];

  @Tool({
    name: 'deployRelease',
    description: 'Deploys a release build to a target environment',
  })
  @UsePolicies(RequireManagerApprovalPolicy)
  deployRelease(
    @Param('releaseTag') releaseTag: string,
    @Param('environment') environment: string,
  ) {
    this.executedDeployments.push({ releaseTag, environment });
    return {
      status: 'deployed',
      releaseTag,
      environment,
      timestamp: new Date().toISOString(),
    };
  }

  @Tool({
    name: 'queryClusterHealth',
    description: 'Queries Kubernetes cluster node status',
  })
  queryClusterHealth(@Param('node') node: string) {
    return { node, status: 'Ready', cpuUsage: '22%' };
  }
}

@Agent({
  name: 'DevOpsAgent',
  description: 'Automates cloud infrastructure and deployment tasks',
})
class DevOpsAgent implements AgentProvider {
  constructor(private readonly tools: DevOpsToolSet) {}

  define(): AgentConfig {
    return {
      instructions: 'You are a DevOps automation assistant. Perform tasks safely.',
      tools: [this.tools],
    };
  }
}

// -----------------------------------------------------------------------------
// Mock Model Adapters
// -----------------------------------------------------------------------------

class HitlModelAdapter implements ModelAdapter {
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const messages = request.messages;
    const lastToolMsg = messages.slice().reverse().find((m) => m.role === 'tool');

    if (!lastToolMsg) {
      // First turn round: Model decides to call deployRelease tool
      return {
        content: 'I will trigger the production deployment.',
        toolCalls: [
          {
            id: 'call_deploy_001',
            name: 'deployRelease',
            args: { releaseTag: 'v2.5.0', environment: 'production' },
          },
        ],
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
      };
    }

    // Post-approval resumed round: Model inspects tool result and provides final response
    return {
      content: `Deployment of release v2.5.0 to production completed successfully.`,
      usage: { inputTokens: 70, outputTokens: 15, totalTokens: 85 },
    };
  }
}

class MidLoopCrashModelAdapter implements ModelAdapter {
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const messages = request.messages;
    const toolMsgCount = messages.filter((m) => m.role === 'tool').length;

    if (toolMsgCount === 0) {
      return {
        content: 'Checking node 1...',
        toolCalls: [
          { id: 'call_node_1', name: 'queryClusterHealth', args: { node: 'node-1' } },
        ],
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      };
    }

    if (toolMsgCount === 1) {
      return {
        content: 'Checking node 2...',
        toolCalls: [
          { id: 'call_node_2', name: 'queryClusterHealth', args: { node: 'node-2' } },
        ],
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
      };
    }

    // Resumed instance finishes turn
    return {
      content: 'All cluster nodes are healthy and ready.',
      usage: { inputTokens: 75, outputTokens: 12, totalTokens: 87 },
    };
  }
}

// -----------------------------------------------------------------------------
// Test Suite Execution
// -----------------------------------------------------------------------------

export async function runCrashRecoveryHitlTests() {
  console.log('🧪 Starting Crash Recovery, Process Restart, and HITL Integration Test Suite...\n');

  // =========================================================================
  // Test 1: Redis HITL Crash & Multi-Instance Approval Recovery
  // =========================================================================
  {
    console.log('  - Test 1: Multi-Instance Redis HITL Approval Recovery (Process A crashes -> Process B settles)');
    const fakeRedis = createSharedFakeRedis();

    const approvalStoreA = new RedisApprovalStore({ client: fakeRedis.client });
    const sessionStoreA = new RedisSessionStore({ client: fakeRedis.client });
    const stateStoreA = new RedisStateStore({ client: fakeRedis.client });

    const modelAdapterA = new HitlModelAdapter();
    const observerA = new InMemoryAgentObserver();

    // 1. Boot Process A
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterA,
          approvalStore: approvalStoreA,
          sessionStore: sessionStoreA,
          stateStore: stateStoreA,
          observers: [observerA],
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);
    const resultA = await runnerA.run('DevOpsAgent', {
      sessionId: 'sess_prod_deploy_1',
      message: 'Please deploy v2.5.0 to production',
    });

    // Verification: Turn suspended for approval
    assert(resultA.toolCalls.length === 1, 'Process A should register 1 tool call');
    const pendingCall = resultA.toolCalls[0];
    assert(
      (pendingCall.result as { status: string }).status === 'pending_approval',
      'Process A result should be pending_approval',
    );
    const approvalId = (pendingCall.result as { approvalId: string }).approvalId;
    assert(Boolean(approvalId), 'Process A must return an approvalId');

    // 2. Terminate Process A (Simulate Crash / Pod Restart)
    await moduleA.close();

    // Verify stored approval exists in Redis
    const savedInRedis = await fakeRedis.client.get(`agentic:approval:${approvalId}`);
    assert(Boolean(savedInRedis), 'Approval record must be persisted in shared Redis store');

    // 3. Boot Process B (Brand new DI container sharing ONLY Redis)
    const approvalStoreB = new RedisApprovalStore({ client: fakeRedis.client });
    const sessionStoreB = new RedisSessionStore({ client: fakeRedis.client });
    const stateStoreB = new RedisStateStore({ client: fakeRedis.client });

    const modelAdapterB = new HitlModelAdapter();
    const observerB = new InMemoryAgentObserver();

    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterB,
          approvalStore: approvalStoreB,
          sessionStore: sessionStoreB,
          stateStore: stateStoreB,
          observers: [observerB],
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const approvalServiceB = moduleB.get(ApprovalService);

    // Human approves deployment on Process B
    const resultB = await approvalServiceB.approve(approvalId);

    assert(
      isAgentResult(resultB) &&
        resultB.output === 'Deployment of release v2.5.0 to production completed successfully.',
      `Process B output should match final round: ${isAgentResult(resultB) ? resultB.output : 'non-agent-result'}`,
    );

    // Verify side effect ran in Process B
    const devOpsToolSetB = moduleB.get(DevOpsToolSet);
    assert(
      devOpsToolSetB.executedDeployments.length === 1,
      'Process B must execute the approved tool once',
    );
    assert(
      devOpsToolSetB.executedDeployments[0].releaseTag === 'v2.5.0',
      'Release tag should match',
    );

    // Verify approval record was atomically claimed/deleted from Redis
    const postApprovalInRedis = await fakeRedis.client.get(`agentic:approval:${approvalId}`);
    assert(postApprovalInRedis === null, 'Approval must be cleared from Redis after settlement');

    await moduleB.close();
    console.log('    ✓ Redis multi-instance crash & HITL approval resolution verified');
  }

  // =========================================================================
  // Test 2: PostgreSQL HITL Crash & Multi-Instance Approval Recovery
  // =========================================================================
  {
    console.log('  - Test 2: Multi-Instance PostgreSQL HITL Approval Recovery (DELETE RETURNING atomicity)');
    const fakePg = createFakePostgres();

    const approvalStoreA = new PostgresApprovalStore({ client: fakePg.client });
    const sessionStoreA = new PostgresSessionStore({ client: fakePg.client });
    const stateStoreA = new PostgresStateStore({ client: fakePg.client });

    const modelAdapterA = new HitlModelAdapter();

    // 1. Boot Process A
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterA,
          approvalStore: approvalStoreA,
          sessionStore: sessionStoreA,
          stateStore: stateStoreA,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);
    const resultA = await runnerA.run('DevOpsAgent', {
      sessionId: 'sess_pg_deploy_1',
      message: 'Deploy v2.5.0 to production',
    });

    const approvalId = (resultA.toolCalls[0].result as { approvalId: string }).approvalId;
    assert(Boolean(approvalId), 'Process A returned approvalId');

    // 2. Kill Process A
    await moduleA.close();

    // 3. Boot Process B
    const approvalStoreB = new PostgresApprovalStore({ client: fakePg.client });
    const sessionStoreB = new PostgresSessionStore({ client: fakePg.client });
    const stateStoreB = new PostgresStateStore({ client: fakePg.client });

    const modelAdapterB = new HitlModelAdapter();

    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterB,
          approvalStore: approvalStoreB,
          sessionStore: sessionStoreB,
          stateStore: stateStoreB,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const approvalServiceB = moduleB.get(ApprovalService);
    const resultB = await approvalServiceB.approve(approvalId);

    assert(
      isAgentResult(resultB) && resultB.output.includes('completed successfully'),
      'Process B resumed turn to completion in PostgreSQL',
    );

    // Verify single atomic claim in Postgres
    const secondClaim = await approvalStoreB.get(approvalId);
    assert(secondClaim === null, 'Approval row must be deleted from Postgres table');

    await moduleB.close();
    console.log('    ✓ PostgreSQL multi-instance crash & HITL approval resolution verified');
  }

  // =========================================================================
  // Test 3: Mid-Loop Process Crash & In-Flight Checkpoint Resumption
  // =========================================================================
  {
    console.log('  - Test 3: Mid-Loop Process Crash & In-Flight Checkpoint Recovery across instances');
    const fakeRedis = createSharedFakeRedis();

    const stateStoreA = new RedisStateStore({ client: fakeRedis.client });
    const sessionStoreA = new RedisSessionStore({ client: fakeRedis.client });
    const modelAdapterA = new MidLoopCrashModelAdapter();

    // 1. Process A starts multi-step inspection turn
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterA,
          stateStore: stateStoreA,
          sessionStore: sessionStoreA,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);

    // Run stream until 2nd tool completes, then simulate sudden process crash
    let streamedEventsCount = 0;
    for await (const event of runnerA.runStream('DevOpsAgent', {
      sessionId: 'sess_midloop_crash_1',
      message: 'Check all cluster nodes health',
    })) {
      streamedEventsCount++;
      const res = event.type === 'tool_result' ? (event.result as { data?: { node?: string } }) : undefined;
      if (res?.data?.node === 'node-2') {
        // Crash Process A right after node-2 completes
        break;
      }
    }

    assert(streamedEventsCount > 0, 'Process A should have streamed events');

    // 2. Kill Process A
    await moduleA.close();

    // 3. Process B boots up fresh, checks for in-flight checkpoint, and resumes
    const stateStoreB = new RedisStateStore({ client: fakeRedis.client });
    const sessionStoreB = new RedisSessionStore({ client: fakeRedis.client });
    const modelAdapterB = new MidLoopCrashModelAdapter();

    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: modelAdapterB,
          stateStore: stateStoreB,
          sessionStore: sessionStoreB,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerB = moduleB.get(AgentRunner);

    // Recover latest in-flight checkpoint and resume to completion
    const finalResult = await runnerB.recoverLatestCheckpoint('DevOpsAgent', 'sess_midloop_crash_1');

    assert(
      finalResult.output === 'All cluster nodes are healthy and ready.',
      `Process B resumed from checkpoint to final answer: ${finalResult.output}`,
    );

    await moduleB.close();
    console.log('    ✓ Mid-loop process crash & in-flight checkpoint resumption verified');
  }

  // =========================================================================
  // Test 4: Multi-Instance Rejection Handling Post-Restart
  // =========================================================================
  {
    console.log('  - Test 4: Multi-Instance Approval Rejection Post-Restart');
    const fakeRedis = createSharedFakeRedis();

    const approvalStoreA = new RedisApprovalStore({ client: fakeRedis.client });
    const sessionStoreA = new RedisSessionStore({ client: fakeRedis.client });

    class RejectionAwareModelAdapter implements ModelAdapter {
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const lastToolMsg = request.messages.slice().reverse().find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Deploying...',
            toolCalls: [{ id: 'call_rej_1', name: 'deployRelease', args: { releaseTag: 'v1.0.0', environment: 'production' } }],
          };
        }
        return {
          content: 'The deployment was rejected by the supervisor.',
        };
      }
    }

    // 1. Process A suspends and terminates
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new RejectionAwareModelAdapter(),
          approvalStore: approvalStoreA,
          sessionStore: sessionStoreA,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);
    const resultA = await runnerA.run('DevOpsAgent', {
      sessionId: 'sess_reject_1',
      message: 'Deploy v1.0.0 to prod',
    });

    const approvalId = (resultA.toolCalls[0].result as { approvalId: string }).approvalId;
    await moduleA.close();

    // 2. Process B rejects the approval
    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new RejectionAwareModelAdapter(),
          approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
          sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const approvalServiceB = moduleB.get(ApprovalService);
    const resultB = await approvalServiceB.reject(approvalId, { reason: 'Unauthorized change window' });

    assert(
      isAgentResult(resultB) && resultB.output.includes('rejected by the supervisor'),
      'Process B surfaced rejection safely to model',
    );

    // Verify tool was never executed
    const devOpsToolSetB = moduleB.get(DevOpsToolSet);
    assert(devOpsToolSetB.executedDeployments.length === 0, 'Rejected tool must never execute');

    await moduleB.close();
    console.log('    ✓ Multi-instance post-restart rejection verified');
  }

  // =========================================================================
  // Test 5: Concurrent Multi-Instance Race Condition on Approval Claim
  // =========================================================================
  {
    console.log('  - Test 5: Concurrent Multi-Instance Claim (Exactly-once atomic settlement guarantee)');
    const fakeRedis = createSharedFakeRedis();

    const approvalStore = new RedisApprovalStore({ client: fakeRedis.client });
    const sessionStore = new RedisSessionStore({ client: fakeRedis.client });
    const modelAdapter = new HitlModelAdapter();

    // 1. Process A creates approval and dies
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          approvalStore,
          sessionStore,
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);
    const resultA = await runnerA.run('DevOpsAgent', {
      sessionId: 'sess_race_1',
      message: 'Deploy v2.5.0',
    });

    const approvalId = (resultA.toolCalls[0].result as { approvalId: string }).approvalId;
    await moduleA.close();

    // 2. Start two independent instances: Process B and Process C
    const createInstance = async () => {
      return Test.createTestingModule({
        imports: [
          AgenticModule.forRoot({
            defaultModel: { provider: 'openai', model: 'gpt-4o' },
            modelAdapter: new HitlModelAdapter(),
            approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
            sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
          }),
          AgenticModule.forFeature({
            agents: [DevOpsAgent],
            toolSets: [DevOpsToolSet],
          }),
        ],
      }).compile();
    };

    const [moduleB, moduleC] = await Promise.all([createInstance(), createInstance()]);

    const serviceB = moduleB.get(ApprovalService);
    const serviceC = moduleC.get(ApprovalService);

    // 3. Concurrently race to approve the same approvalId
    const settled = await Promise.allSettled([
      serviceB.approve(approvalId),
      serviceC.approve(approvalId),
    ]);

    const successes = settled.filter((s) => s.status === 'fulfilled');
    const failures = settled.filter((s) => s.status === 'rejected');

    assert(successes.length === 1, `Exactly 1 instance must succeed claiming approval, got ${successes.length}`);
    assert(failures.length === 1, `Exactly 1 instance must fail due to concurrent claim, got ${failures.length}`);

    const failureReason = (failures[0] as PromiseRejectedResult).reason;
    assert(
      failureReason instanceof ApprovalNotFoundError,
      'Second concurrent claim must throw ApprovalNotFoundError',
    );

    await Promise.all([moduleB.close(), moduleC.close()]);
    console.log('    ✓ Distributed concurrent atomic single-claim verified');
  }

  // =========================================================================
  // Test 6: Expired Approval Handling Across Process Restarts
  // =========================================================================
  {
    console.log('  - Test 6: Expired Approval TTL across process restart');
    const fakeRedis = createSharedFakeRedis();

    // 1. Process A creates approval with 1-second TTL
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new HitlModelAdapter(),
          approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
          sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);
    const resultA = await runnerA.run('DevOpsAgent', {
      sessionId: 'sess_expire_1',
      message: 'Deploy v2.5.0',
    });

    const approvalId = (resultA.toolCalls[0].result as { approvalId: string }).approvalId;
    await moduleA.close();

    // Fast-forward time in fake Redis to expire TTL
    fakeRedis.ttls.set(`agentic:approval:${approvalId}`, Date.now() - 5000);

    // 2. Process B attempts to approve expired request
    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new HitlModelAdapter(),
          approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
          sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const serviceB = moduleB.get(ApprovalService);
    let expiredThrown = false;
    try {
      await serviceB.approve(approvalId);
    } catch (err) {
      if (err instanceof ApprovalNotFoundError || err instanceof ApprovalExpiredError) {
        expiredThrown = true;
      }
    }

    assert(expiredThrown, 'Expired approval must be rejected after process restart');
    await moduleB.close();
    console.log('    ✓ Post-restart approval expiration verified');
  }

  // =========================================================================
  // Test 7: Multi-Tenant State Isolation Across Process Restarts
  // =========================================================================
  {
    console.log('  - Test 7: Multi-Tenant State Isolation across process crash and recovery');
    const fakeRedis = createSharedFakeRedis();

    // 1. Process A suspends approvals for Tenant 1 and Tenant 2 under identical sessionId
    const moduleA = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new HitlModelAdapter(),
          approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
          sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const runnerA = moduleA.get(AgentRunner);

    const resTenant1 = await runnerA.run('DevOpsAgent', {
      sessionId: 'shared_session_name',
      message: 'Deploy for tenant 1',
      context: { tenantId: 'tenant_alpha' },
    });
    const approvalId1 = (resTenant1.toolCalls[0].result as { approvalId: string }).approvalId;

    const resTenant2 = await runnerA.run('DevOpsAgent', {
      sessionId: 'shared_session_name',
      message: 'Deploy for tenant 2',
      context: { tenantId: 'tenant_beta' },
    });
    const approvalId2 = (resTenant2.toolCalls[0].result as { approvalId: string }).approvalId;

    await moduleA.close();

    // 2. Process B settles only Tenant 1
    const moduleB = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: new HitlModelAdapter(),
          approvalStore: new RedisApprovalStore({ client: fakeRedis.client }),
          sessionStore: new RedisSessionStore({ client: fakeRedis.client }),
        }),
        AgenticModule.forFeature({
          agents: [DevOpsAgent],
          toolSets: [DevOpsToolSet],
          policies: [RequireManagerApprovalPolicy],
        }),
      ],
    }).compile();

    const serviceB = moduleB.get(ApprovalService);
    const settled1 = await serviceB.approve(approvalId1);
    assert(isAgentResult(settled1) && settled1.output.includes('v2.5.0'), 'Tenant 1 turn completed');

    // Verify Tenant 2's approval is still untouched in Redis
    const remainingApproval2 = await fakeRedis.client.get(`agentic:approval:${approvalId2}`);
    assert(Boolean(remainingApproval2), 'Tenant 2 approval must remain pending and isolated');

    // Settle Tenant 2
    const settled2 = await serviceB.approve(approvalId2);
    assert(isAgentResult(settled2) && settled2.output.includes('v2.5.0'), 'Tenant 2 turn completed');

    await moduleB.close();
    console.log('    ✓ Multi-tenant state isolation across restarts verified');
  }

  console.log('🎉 All Crash Recovery, Process Restart, and HITL Integration Tests Passed!\n');
}
