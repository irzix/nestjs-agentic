import { SemanticMemory } from '@nestjs-agentic/memory';
import {
  ContextualCompressionStrategy,
  GraphRAGStrategy,
  HybridVectorStore,
  InMemoryKnowledgeGraphProvider,
  KnowledgeBase,
  MockEmbeddingProvider,
  ParentChildHydrationStrategy,
  ParentChildSplitter,
  QueryExpansionStrategy,
  RAGPipeline,
  RerankerStrategy,
  SemanticDocumentSplitter,
} from '../src';

export async function runRAGTests() {
  console.log('🧪 Running @nestjs-agentic/rag Comprehensive Unit Tests...\n');

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

  // TEST 1: SemanticDocumentSplitter
  try {
    const splitter = new SemanticDocumentSplitter({ maxChunkSize: 100 });
    const chunks = await splitter.splitDocument({
      id: 'doc_1',
      title: 'Governance Guide',
      rawContent: '# Section 1\nHigh amount transfer limits.\n\n# Section 2\nRequires approval.',
      chunks: [],
      metadata: {},
    });

    assert(chunks.length === 2, 'Test 1a: SemanticDocumentSplitter split document into sections');
    assert(chunks[0].content.includes('Section 1'), 'Test 1b: First chunk section content matches');
  } catch (err: any) {
    assert(false, 'Test 1: SemanticDocumentSplitter', err.message);
  }

  // TEST 2: ParentChildSplitter & Hydration
  try {
    const splitter = new ParentChildSplitter({ parentChunkSize: 200, childChunkSize: 50 });
    const { parentChunks, childChunks } = await splitter.splitParentChild({
      id: 'doc_2',
      title: 'Policy Manual',
      rawContent: 'Parent Section Text: Financial transfer guidelines require multi-factor authentication for any transaction exceeding $10,000.',
      chunks: [],
      metadata: {},
    });

    assert(parentChunks.length === 1, 'Test 2a: Created parent chunk');
    assert(childChunks.length >= 1, 'Test 2b: Created child chunks');
    assert(
      (childChunks[0].metadata.parentText as string)?.includes('Financial transfer guidelines'),
      'Test 2c: Child chunk contains parent text reference',
    );
  } catch (err: any) {
    assert(false, 'Test 2: ParentChildSplitter', err.message);
  }

  // TEST 3: QueryExpansionStrategy (Dictionary & LLM)
  try {
    const strategy = new QueryExpansionStrategy({
      synonymsMap: { transfer: ['payment'] },
      useLLM: true,
      llmProvider: async (prompt) => 'wire transfer limit, remittance governance',
    });
    const result = await strategy.process({ query: 'transfer policy' });

    assert(Boolean(result.expandedQueries), 'Test 3a: Expanded queries generated');
    assert(
      result.expandedQueries!.some((q) => q.includes('payment')),
      'Test 3b: Synonym "payment" expanded for "transfer"',
    );
    assert(
      result.expandedQueries!.some((q) => q.includes('remittance governance')),
      'Test 3c: LLM provider generated semantic sub-queries when useLLM=true',
    );
  } catch (err: any) {
    assert(false, 'Test 3: QueryExpansionStrategy', err.message);
  }

  // TEST 4: KnowledgeBase Ingestion & Hybrid Search
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const store = new HybridVectorStore({ embeddingProvider: mockEmbed });
    const kb = new KnowledgeBase({ vectorStore: store });

    await kb.ingestDocument({
      title: 'Ledger Rules',
      rawContent: 'Transfer transactions require ledger approval',
    });

    const matches = await kb.queryChunks('transfer ledger');
    assert(matches.length === 1, 'Test 4a: KnowledgeBase ingested & retrieved matching chunk');
    assert(matches[0].content.includes('ledger approval'), 'Test 4b: Retrieved chunk content matches');
  } catch (err: any) {
    assert(false, 'Test 4: KnowledgeBase Ingestion & Search', err.message);
  }

  // TEST 5: InMemoryKnowledgeGraphProvider Entity Traversal
  try {
    const graph = new InMemoryKnowledgeGraphProvider();
    await graph.addNode({ id: 'usr_mgr', label: 'User', properties: { role: 'manager' } });
    await graph.addNode({ id: 'pol_audit', label: 'Policy', properties: { name: 'Audit Policy' } });
    await graph.addEdge({ sourceId: 'usr_mgr', targetId: 'pol_audit', relation: 'GOVERNED_BY' });

    const subGraph = await graph.querySubGraph('usr_mgr');
    assert(subGraph.nodes.length === 2, 'Test 5a: Subgraph entity nodes traversed');
    assert(subGraph.edges.length === 1, 'Test 5b: Subgraph relation edge matches GOVERNED_BY');

    const graphStrategy = new GraphRAGStrategy({ graphProvider: graph });
    const graphContextResult = await graphStrategy.process({ query: 'usr_mgr audit' });
    assert(Boolean(graphContextResult.graphContext), 'Test 5c: GraphRAGStrategy generated relational facts');
    assert(
      graphContextResult.graphContext!.includes('GOVERNED_BY'),
      'Test 5d: GraphRAGStrategy relational facts text contains GOVERNED_BY relation',
    );
  } catch (err: any) {
    assert(false, 'Test 5: Knowledge Graph Traversal & GraphRAGStrategy', err.message);
  }

  // TEST 6: RAGPipeline Modular Chained Execution
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const store = new HybridVectorStore({ embeddingProvider: mockEmbed });
    const kb = new KnowledgeBase({ vectorStore: store });

    await kb.ingestDocument({
      title: 'Security Manual',
      rawContent: 'Wire transfer reimbursement policies require manager clearance.',
    });

    const pipeline = new RAGPipeline({
      knowledgeBase: kb,
      strategies: [
        new QueryExpansionStrategy(),
        new ParentChildHydrationStrategy(),
        new RerankerStrategy(),
        new ContextualCompressionStrategy({ maxCharacters: 500 }),
      ],
    });

    const context = await pipeline.executePipeline('wire transfer');
    assert(Boolean(context.compressedContext), 'Test 6a: RAGPipeline executed chained strategies');
    assert(
      context.compressedContext!.includes('reimbursement'),
      'Test 6b: Compressed context contains retrieved content',
    );
  } catch (err: any) {
    assert(false, 'Test 6: RAGPipeline Execution', err.message);
  }

  // TEST 7: SemanticStoreProvider Integration with @nestjs-agentic/memory
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const hybridStore = new HybridVectorStore({ embeddingProvider: mockEmbed });
    const memory = new SemanticMemory({ provider: hybridStore });

    await memory.save({
      id: 'rag_mem_1',
      sessionId: 'sess_rag_101',
      type: 'semantic',
      content: 'User account billing tier is enterprise premium',
    });

    const recalled = await memory.recall('billing enterprise', { sessionId: 'sess_rag_101' });
    assert(recalled.length === 1, 'Test 7a: HybridVectorStore integrated into @nestjs-agentic/memory SemanticMemory');
    assert(recalled[0].content.includes('enterprise premium'), 'Test 7b: Recalled content matches');
  } catch (err: any) {
    assert(false, 'Test 7: Memory Integration', err.message);
  }

  console.log(`\n  📊 RAG Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('RAG Unit Tests Failed');
  }
}

if (require.main === module) {
  runRAGTests().catch(() => process.exit(1));
}
