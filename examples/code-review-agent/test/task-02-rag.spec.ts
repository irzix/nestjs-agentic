import * as assert from 'node:assert';
import { CodebaseRAGService } from '../src/rag/codebase-rag.service';
import { RepositoryInspector } from '../src/ingestion/repository-inspector';

async function runTask02Tests() {
  console.log('🧪 Running Njent Task 02: AST Codebase RAG & Hybrid Search Tests...\n');

  const ragService = new CodebaseRAGService(new (require('@nestjs-agentic/rag')).MockEmbeddingProvider());

  const sampleFiles = [
    {
      filePath: 'src/orders/refund-limit.policy.ts',
      content: `
import { Injectable } from '@nestjs/common';
import { ToolPolicy, AgentContext, PolicyResult } from 'nestjs-agentic';

@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(ctx: AgentContext, toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Refund exceeds $500' }
      : { decision: 'allow' };
  }
}
`,
    },
    {
      filePath: 'src/orders/order.service.ts',
      content: `
import { Injectable } from '@nestjs/common';
import { RefundLimitPolicy } from './refund-limit.policy';

@Injectable()
export class OrderService {
  constructor(private readonly policy: RefundLimitPolicy) {}

  async processRefund(orderId: string, amount: number) {
    return { orderId, amount, status: 'processed' };
  }
}
`,
    },
  ];

  // Test 1: Ingestion
  const indexedCount = await ragService.ingestCodebase(sampleFiles);
  assert.ok(indexedCount > 0, 'Chunks should be indexed into KnowledgeBase');
  console.log(`  ✅ PASS: Test 1: Indexed ${indexedCount} AST chunks from codebase`);

  // Test 2: Retrieval
  const retrieved = await ragService.retrieveContext('RefundLimitPolicy');
  assert.ok(retrieved.length > 0, 'Should retrieve matching AST chunks');
  assert.ok(
    retrieved.some((c) => c.includes('RefundLimitPolicy')),
    'Retrieved chunks must include RefundLimitPolicy definition',
  );
  console.log('  ✅ PASS: Test 2: AST Context retrieved for symbol query');

  // Test 3: Graph Relationships
  const graph = ragService.getGraphProvider();
  const subGraph = await graph.querySubGraph('OrderService', 1);
  assert.ok(
    subGraph.edges.some((e) => e.targetId === 'RefundLimitPolicy' || e.sourceId === 'OrderService'),
    'Graph should reflect OrderService relationships',
  );
  console.log('  ✅ PASS: Test 3: GraphRAG traced class constructor dependencies');

  // Test 4: RepositoryInspector Path Validation & Security Denylist
  const secretPath = RepositoryInspector.validateAndSanitizePath('.env.production');
  assert.strictEqual(secretPath.valid, false, '.env should be rejected');

  const keyPath = RepositoryInspector.validateAndSanitizePath('certs/server.key');
  assert.strictEqual(keyPath.valid, false, '.key should be rejected');

  const traversalPath = RepositoryInspector.validateAndSanitizePath('../../etc/passwd');
  assert.strictEqual(traversalPath.valid, false, 'Path traversal should be rejected');

  const encodedTraversal = RepositoryInspector.validateAndSanitizePath('%2e%2e/etc/passwd');
  assert.strictEqual(encodedTraversal.valid, false, 'Percent-encoded traversal should be rejected');

  const validPath = RepositoryInspector.validateAndSanitizePath('src/agent/sample.ts');
  assert.strictEqual(validPath.valid, true, 'Valid TypeScript path should be accepted');
  console.log('  ✅ PASS: Test 4: RepositoryInspector validated path security & encoded traversal boundaries');

  // Test 5: Dynamic Workspace Directory Discovery
  const mockRootPkg = JSON.stringify({
    name: 'custom-monorepo',
    workspaces: ['packages/*', 'apps/*'],
  });
  const workspaceDirs = RepositoryInspector.discoverWorkspaceDirectories(mockRootPkg);
  assert.ok(workspaceDirs.includes('packages'), 'Discovered packages workspace directory');
  assert.ok(workspaceDirs.includes('apps'), 'Discovered apps workspace directory');
  console.log('  ✅ PASS: Test 5: Dynamic monorepo workspace directory discovery without hardcoded paths');

  // Test 6: Secret Content Redaction
  const rawSensitiveCode = 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"; const sk = "sk-1234567890abcdefghijklmnopqrstuvwxyz";';
  const scrubbed = RepositoryInspector.redactSecrets(rawSensitiveCode);
  assert.ok(!scrubbed.includes('ghp_1234567890'), 'GitHub token must be redacted');
  assert.ok(!scrubbed.includes('sk-1234567890'), 'OpenAI key must be redacted');
  assert.ok(scrubbed.includes('[REDACTED_SECRET_TOKEN]'), 'Replacement token must be inserted');
  console.log('  ✅ PASS: Test 6: In-memory secret scrubbing before vectorization');

  console.log('\n🎉 All 6 Task 02 AST RAG & Security tests passed successfully!\n');
}

runTask02Tests().catch((err) => {
  console.error('❌ Task 02 tests failed:', err);
  process.exit(1);
});
