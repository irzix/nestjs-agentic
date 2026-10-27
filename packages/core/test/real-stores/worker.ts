import 'reflect-metadata';
import { appendFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import {
  Agent, AgenticModule, AgentRunner, ApprovalService, Tool, ToolSet, UsePolicies,
  RedisApprovalStore, RedisSessionStore, RedisStateStore,
  PostgresApprovalStore, PostgresSessionStore, PostgresStateStore,
} from '../../src';
import type { AgentConfig, AgentProvider, ModelAdapter, ModelRequest, PolicyResult, ToolPolicy, GenericRedisClient, ToolExecutionResult } from '../../src';

const [backend, action, sessionId, ledgerPath, approvalId] = process.argv.slice(2);
const tenantId = 'real-store-test';
const send = (message: unknown) => process.send?.(message);
const forever = () => new Promise<never>(() => undefined);

class ApprovalPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return action === 'mid' || action === 'recover'
      ? { decision: 'allow' }
      : { decision: 'require_approval', reason: 'Human confirmation required' };
  }
}

@ToolSet({ name: 'recovery' })
class RecoveryTools {
  @Tool({ name: 'recordEffect', description: 'Append one durable test side effect' })
  @UsePolicies(ApprovalPolicy)
  recordEffect() {
    appendFileSync(ledgerPath, `${sessionId}\n`);
    return { recorded: true };
  }
}

@Agent({ name: 'recovery-agent', description: 'Deterministic recovery integration fixture' })
class RecoveryAgent implements AgentProvider {
  constructor(private readonly tools: RecoveryTools) {}
  define(): AgentConfig { return { instructions: 'Record the test effect.', tools: [this.tools] }; }
}

async function main() {
  const redis = backend === 'redis' ? new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 }) : undefined;
  const pool = backend === 'postgres' ? new Pool({ connectionString: process.env.POSTGRES_URL, connectionTimeoutMillis: 5000 }) : undefined;
  // pg allows nullable rowCount; the framework's structural client makes it optional.
  const pgClient = pool ? {
    async query<R>(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      return { rows: result.rows as R[], rowCount: result.rowCount ?? undefined };
    },
  } : undefined;
  const redisClient: GenericRedisClient | undefined = redis ? {
    get: (key) => redis.get(key),
    set: (key, value, mode, duration, flag) => redis.call('SET', key, value,
      ...[mode, duration, flag].filter((arg): arg is string | number => arg !== undefined)),
    del: (key) => redis.del(key),
    keys: (pattern) => redis.keys(pattern),
    getdel: (key) => redis.getdel(key),
    eval: (script, numKeys, ...args) => redis.eval(script, numKeys, ...args),
  } : undefined;
  const stores = redisClient ? {
    approvalStore: new RedisApprovalStore({ client: redisClient }),
    sessionStore: new RedisSessionStore({ client: redisClient }),
    stateStore: new RedisStateStore({ client: redisClient }),
  } : {
    approvalStore: new PostgresApprovalStore({ client: pgClient! }),
    sessionStore: new PostgresSessionStore({ client: pgClient! }),
    stateStore: new PostgresStateStore({ client: pgClient! }),
  };
  const model: ModelAdapter = {
    async generate(request: ModelRequest) {
      if (!request.messages.some((m) => m.role === 'tool')) {
        return { content: '', toolCalls: [{ id: 'effect-call', name: 'recordEffect', args: {} }] };
      }
      if (action === 'mid') {
        // The previous model/tool round has been synchronously checkpointed before this call.
        send({ type: 'checkpointed' });
        return forever();
      }
      return { content: 'Effect recorded after recovery.' };
    },
  };
  const app = await Test.createTestingModule({ imports: [
    AgenticModule.forRoot({ ...stores, modelAdapter: model, defaultModel: { model: 'deterministic' },
      approvals: { enforceTenantIsolation: true, enforceSeparationOfDuties: true },
    }),
    AgenticModule.forFeature({ agents: [RecoveryAgent], toolSets: [RecoveryTools], policies: [ApprovalPolicy] }),
  ] }).compile();
  try {
    if (action === 'suspend' || action === 'mid') {
      const result = await app.get(AgentRunner).run('recovery-agent', {
        sessionId, message: 'Record effect', context: { tenantId, userId: 'requester' },
      });
      const pending = result.toolCalls[0]?.result as ToolExecutionResult | undefined;
      if (!pending || pending.success || pending.status !== 'pending_approval') throw new Error('Expected pending approval');
      send({ type: 'suspended', approvalId: pending.approvalId });
      await forever(); // parent SIGKILLs this process, without graceful close
    } else if (action === 'recover') {
      const result = await app.get(AgentRunner).recoverLatestCheckpoint('recovery-agent', sessionId, { context: { tenantId } });
      send({ type: 'recovered', output: result.output });
    } else {
      // Synchronize two independent approvers after both boot, before either claims.
      send({ type: 'ready' });
      await new Promise<void>((resolve) => process.once('message', () => resolve()));
      try {
        const result = await app.get(ApprovalService).approve(approvalId, {
          actor: { userId: 'approver', tenantId: action === 'wrong-tenant' ? 'other-tenant' : tenantId },
        });
        send({ type: 'approved', output: 'output' in result ? result.output : undefined });
      } catch (err: unknown) {
        send({ type: 'refused', error: err instanceof Error ? err.name : String(err) });
      }
    }
  } finally {
    await app.close();
    if (redis) await redis.quit();
    if (pool) await pool.end();
    process.disconnect?.();
  }
}
main().catch((err: unknown) => { console.error(err); process.exit(1); });
