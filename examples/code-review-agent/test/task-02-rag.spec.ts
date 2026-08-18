import * as assert from 'node:assert';
import { CodebaseRAGService } from '../src/rag/codebase-rag.service';

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

  console.log('\n🎉 All 3 Task 02 AST RAG tests passed successfully!\n');
}

runTask02Tests().catch((err) => {
  console.error('❌ Task 02 tests failed:', err);
  process.exit(1);
});
