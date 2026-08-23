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
  VectorStoreFactory,
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

  // TEST 4B: HybridVectorStore computes real BM25 (IDF-weighted), not plain term frequency
  try {
    const store = new HybridVectorStore({ vectorWeight: 0 }); // no embeddingProvider: isolates the sparse score

    // "policy" appears in every chunk (high document frequency -> low IDF).
    // "quota" appears only in chunkB (document frequency 1 -> high IDF).
    await store.addChunks([
      { id: 'chunkR', parentId: 'p1', content: 'policy policy policy policy policy', metadata: {} },
      { id: 'chunkB', parentId: 'p1', content: 'policy quota shipment tracking system update', metadata: {} },
      { id: 'filler1', parentId: 'p1', content: 'policy guidelines for account holders', metadata: {} },
      { id: 'filler2', parentId: 'p1', content: 'policy applies to all users policy', metadata: {} },
      { id: 'filler3', parentId: 'p1', content: 'policy update effective immediately', metadata: {} },
      { id: 'filler4', parentId: 'p1', content: 'policy review scheduled next quarter policy', metadata: {} },
    ]);

    const results = await store.searchHybrid('policy quota', 2);

    // Under the old TF-only formula (matchCount / tokens.length), chunkR
    // scores 5/5 = 1.0 (every token matches) while chunkB scores 2/6 = 0.33
    // (four of its six tokens are filler) -- chunkR would incorrectly rank
    // first despite not containing "quota" at all. Real BM25's IDF term
    // down-weights "policy" (present in all 6 chunks) and up-weights the
    // rare, distinctive "quota" (present in only 1), so chunkB must rank
    // above chunkR.
    assert(
      results[0]?.id === 'chunkB',
      'Test 4Ba: Chunk containing the rare/distinctive term "quota" ranks first under real BM25',
    );
    assert(
      results.findIndex((c) => c.id === 'chunkB') < results.findIndex((c) => c.id === 'chunkR'),
      'Test 4Bb: Rare-term chunk outranks the common-term-repetition chunk',
    );

    // Deleting a chunk must decrement corpus document-frequency/token-count
    // stats, not just remove it from the results -- otherwise IDF for terms
    // that appeared only in the deleted chunk would stay stale.
    store.deleteChunk('chunkB');
    const afterDelete = await store.searchHybrid('quota', 5);
    assert(
      afterDelete.length === 0,
      'Test 4Bc: Deleting the only chunk containing a term removes it from corpus stats (no stale matches)',
    );
  } catch (err: any) {
    assert(false, 'Test 4B: HybridVectorStore real BM25 scoring', err.message);
  }

  // TEST 4C: HybridVectorStore.addChunks batches unembedded chunks via embedDocuments,
  // instead of issuing one embedQuery call per chunk.
  try {
    let embedQueryCalls = 0;
    let embedDocumentsCalls = 0;
    let lastBatchSize = 0;

    const spyProvider = {
      async embedQuery(text: string) {
        embedQueryCalls++;
        return [text.length];
      },
      async embedDocuments(texts: string[]) {
        embedDocumentsCalls++;
        lastBatchSize = texts.length;
        return texts.map((t) => [t.length]);
      },
    };

    const store = new HybridVectorStore({ embeddingProvider: spyProvider, embeddingBatchSize: 10 });

    const chunksToAdd: Array<{ id: string; parentId: string; content: string; metadata: {}; embedding?: number[] }> =
      Array.from({ length: 7 }, (_, i) => ({
        id: `batch_chunk_${i}`,
        parentId: 'p_batch',
        content: `content for chunk number ${i}`,
        metadata: {},
      }));

    await store.addChunks(chunksToAdd);

    assert(embedDocumentsCalls === 1, 'Test 4Ca: A single batched embedDocuments call handles 7 chunks under batch size 10');
    assert(embedQueryCalls === 0, 'Test 4Cb: embedQuery is never called during ingestion');
    assert(lastBatchSize === 7, 'Test 4Cc: The batch contained all 7 chunk texts');
    assert(
      chunksToAdd.every((c) => Array.isArray(c.embedding)),
      'Test 4Cd: Every input chunk object received its embedding (mutated in place, as documented)',
    );

    // A batch larger than embeddingBatchSize must split into multiple calls.
    embedDocumentsCalls = 0;
    const largeStore = new HybridVectorStore({ embeddingProvider: spyProvider, embeddingBatchSize: 3 });
    const manyChunks = Array.from({ length: 8 }, (_, i) => ({
      id: `large_chunk_${i}`,
      parentId: 'p_large',
      content: `text ${i}`,
      metadata: {},
    }));
    await largeStore.addChunks(manyChunks);
    assert(
      embedDocumentsCalls === 3,
      'Test 4Ce: 8 chunks with embeddingBatchSize=3 split into 3 batched calls (3+3+2), not 8 individual ones',
    );
  } catch (err: any) {
    assert(false, 'Test 4C: HybridVectorStore batches embedding via embedDocuments', err.message);
  }

  // TEST 4D: embeddingBatchSize is validated to prevent an infinite ingestion loop.
  // A value of 0 or a negative number as the loop increment in addChunks
  // would otherwise leave the loop index unchanged forever.
  try {
    const invalidSizes = [0, -1, -100, 1.5, NaN, Infinity];
    let allRejected = true;
    for (const size of invalidSizes) {
      try {
        new HybridVectorStore({ embeddingBatchSize: size });
        allRejected = false;
      } catch {
        // expected
      }
    }
    assert(allRejected, 'Test 4Da: Zero, negative, fractional, NaN, and Infinity batch sizes are all rejected at construction');

    let validAccepted = true;
    try {
      new HybridVectorStore({ embeddingBatchSize: 50 });
    } catch {
      validAccepted = false;
    }
    assert(validAccepted, 'Test 4Db: A valid positive integer batch size is still accepted');
  } catch (err: any) {
    assert(false, 'Test 4D: embeddingBatchSize validation', err.message);
  }

  // TEST 4E: A misaligned embedDocuments response (wrong vector count) is rejected
  // rather than silently attaching undefined/mismatched embeddings.
  try {
    const misalignedProvider = {
      async embedQuery(text: string) {
        return [text.length];
      },
      async embedDocuments(texts: string[]) {
        // Deliberately return one fewer embedding than requested.
        return texts.slice(0, -1).map((t) => [t.length]);
      },
    };

    const store = new HybridVectorStore({ embeddingProvider: misalignedProvider });
    let threw = false;
    try {
      await store.addChunks([
        { id: 'ma_1', parentId: 'p', content: 'alpha', metadata: {} },
        { id: 'ma_2', parentId: 'p', content: 'beta', metadata: {} },
      ]);
    } catch {
      threw = true;
    }
    assert(threw, 'Test 4E: A mismatched embedDocuments response length is rejected, not silently applied');
  } catch (err: any) {
    assert(false, 'Test 4E: Misaligned embedding response validation', err.message);
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

  // TEST 6C: RAGPipeline populates ctx.scores from real retrieval scores (#129)
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const store = new HybridVectorStore({ embeddingProvider: mockEmbed });
    const kb = new KnowledgeBase({ vectorStore: store });

    await kb.ingestDocument({
      title: 'Refund Policy',
      rawContent: 'Refund approval requires manager sign-off for high value orders.',
    });
    await kb.ingestDocument({
      title: 'Unrelated Notes',
      rawContent: 'Company holiday schedule for next year.',
    });

    const pipeline = new RAGPipeline({ knowledgeBase: kb });
    const context = await pipeline.executePipeline('refund approval');

    assert(context.scores instanceof Map, 'Test 6Ca: scores is a Map after executePipeline');
    assert((context.scores?.size ?? 0) > 0, 'Test 6Cb: scores is non-empty for a matching query');
    assert(
      context.chunks!.every((c) => context.scores!.has(c.id)),
      'Test 6Cc: every retrieved chunk has a corresponding score entry',
    );

    // Real scores now drive UShapedContextStrategy's ordering, instead of it
    // trusting whatever order the chunks arrived in.
    const uShaped = new (await import('../src')).UShapedContextStrategy();
    const uContext = uShaped.process(context);
    const scoreOf = (id: string) => context.scores!.get(id) ?? 0;
    if (uContext.chunks!.length > 1) {
      assert(
        scoreOf(uContext.chunks![0].id) >= scoreOf(uContext.chunks![uContext.chunks!.length - 1].id),
        'Test 6Cd: UShapedContextStrategy places the highest-scored chunk ahead of the lowest',
      );
    }
  } catch (err: any) {
    assert(false, 'Test 6C: RAGPipeline populates ctx.scores', err.message);
  }

  // TEST 6D: KnowledgeBase.queryChunksScored falls back to rank-based scores
  // for adapters without searchChunksScored, and passes through real scores otherwise.
  try {
    const { KnowledgeBase: KB } = await import('../src');
    const rankOnlyChunks = [
      { id: 'c1', parentId: 'd1', content: 'alpha', metadata: {} },
      { id: 'c2', parentId: 'd1', content: 'beta', metadata: {} },
    ];
    const rankOnlyAdapter: any = {
      addChunks: async () => {},
      searchChunks: async () => rankOnlyChunks,
    };
    const kbRankOnly = new KB({ vectorStore: rankOnlyAdapter });
    const rankOnlyScored = await kbRankOnly.queryChunksScored('q', 5);
    assert(
      rankOnlyScored[0].score === 1 && rankOnlyScored[1].score === 1 / 2,
      'Test 6Da: fallback rank-based scores are 1, 1/2, ... for adapters without searchChunksScored',
    );

    const realScoredAdapter: any = {
      addChunks: async () => {},
      searchChunks: async () => rankOnlyChunks,
      searchChunksScored: async () => [
        { chunk: rankOnlyChunks[0], score: 0.42 },
        { chunk: rankOnlyChunks[1], score: 0.17 },
      ],
    };
    const kbRealScored = new KB({ vectorStore: realScoredAdapter });
    const realScored = await kbRealScored.queryChunksScored('q', 5);
    assert(
      realScored[0].score === 0.42 && realScored[1].score === 0.17,
      'Test 6Db: real adapter scores propagate through queryChunksScored unchanged',
    );
  } catch (err: any) {
    assert(false, 'Test 6D: queryChunksScored fallback and pass-through', err.message);
  }

  // TEST 6E: RAGPipeline keeps the maximum score when the same chunk matches multiple query variants
  try {
    const sharedChunk = { id: 'shared', parentId: 'd1', content: 'shared chunk', metadata: {} };
    const variantAdapter: any = {
      addChunks: async () => {},
      searchChunks: async (q: string) => (q === 'low variant' ? [sharedChunk] : []),
      searchChunksScored: async (q: string) => {
        if (q === 'low variant') return [{ chunk: sharedChunk, score: 0.2 }];
        if (q === 'high variant') return [{ chunk: sharedChunk, score: 0.9 }];
        return [];
      },
    };
    const kb = new KnowledgeBase({ vectorStore: variantAdapter });
    const pipeline = new RAGPipeline({
      knowledgeBase: kb,
      strategies: [
        {
          name: 'add-high-variant',
          phase: 'pre-retrieval',
          process: async (ctx: any) => ({ ...ctx, expandedQueries: ['high variant'] }),
        },
      ],
    });
    const context = await pipeline.executePipeline('low variant');
    assert(context.scores!.get('shared') === 0.9, 'Test 6Ea: duplicate chunk across query variants keeps the maximum score');
  } catch (err: any) {
    assert(false, 'Test 6E: RAGPipeline max-score-across-variants', err.message);
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

  // TEST 8: Edge Cases & Error Resiliency Suite
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const store = new HybridVectorStore({ embeddingProvider: mockEmbed });
    const kb = new KnowledgeBase({ vectorStore: store });

    // 8a. Empty / Whitespace Query Handling
    const emptyPipeline = new RAGPipeline({ knowledgeBase: kb });
    const emptyResult = await emptyPipeline.executePipeline('   ');
    assert(emptyResult.chunks?.length === 0, 'Test 8a: Empty whitespace query returns zero chunks gracefully');

    // 8b. Reranker Strategy Error Fallback Handling
    const faultyReranker = new RerankerStrategy({
      rerankFn: async () => {
        throw new Error('Cross-Encoder API Service Unavailable');
      },
    });
    const chunkObj = { id: 'c1', parentId: 'p1', content: 'Audit policy content details', metadata: {} };
    const rerankFallbackResult = await faultyReranker.process({ query: 'Audit policy', chunks: [chunkObj] });
    assert(
      rerankFallbackResult.chunks?.length === 1,
      'Test 8b: Faulty Reranker strategy gracefully falls back to default scoring on API error',
    );

    // 8c. Non-existent Graph Entity Query Handling
    const graph = new InMemoryKnowledgeGraphProvider();
    const graphStrategy = new GraphRAGStrategy({ graphProvider: graph });
    const unknownEntityResult = await graphStrategy.process({ query: 'non_existent_node_999' });
    assert(
      !unknownEntityResult.graphContext,
      'Test 8c: Querying non-existent graph entity node returns clean context without throwing',
    );

    // 8d. Multi-Entity Traversal in Single Query
    await graph.addNode({ id: 'usr_cto', label: 'User', properties: {} });
    await graph.addNode({ id: 'pol_sec', label: 'Policy', properties: {} });
    await graph.addNode({ id: 'usr_cfo', label: 'User', properties: {} });
    await graph.addNode({ id: 'pol_fin', label: 'Policy', properties: {} });
    await graph.addEdge({ sourceId: 'usr_cto', targetId: 'pol_sec', relation: 'OWNS' });
    await graph.addEdge({ sourceId: 'usr_cfo', targetId: 'pol_fin', relation: 'MANAGES' });

    // 8d. Multi-Entity Traversal in Single Query
    await graph.addNode({ id: 'usr_cto', label: 'User', properties: {} });
    await graph.addNode({ id: 'pol_sec', label: 'Policy', properties: {} });
    await graph.addNode({ id: 'usr_cfo', label: 'User', properties: {} });
    await graph.addNode({ id: 'pol_fin', label: 'Policy', properties: {} });
    await graph.addEdge({ sourceId: 'usr_cto', targetId: 'pol_sec', relation: 'OWNS' });
    await graph.addEdge({ sourceId: 'usr_cfo', targetId: 'pol_fin', relation: 'MANAGES' });

    const multiEntityResult = await graphStrategy.process({ query: 'usr_cto usr_cfo' });
    assert(
      Boolean(multiEntityResult.graphContext) &&
        multiEntityResult.graphContext!.includes('OWNS') &&
        multiEntityResult.graphContext!.includes('MANAGES'),
      'Test 8d: GraphRAGStrategy traverses multiple graph entities simultaneously in a single query',
    );
  } catch (err: any) {
    assert(false, 'Test 8: Edge Cases & Error Resiliency', err.message);
  }

  // TEST 9: VectorStoreFactory Custom & PgVector Adapter Integration
  try {
    const customStore = VectorStoreFactory.createCustom({
      searchFn: async (query, limit) => [
        { id: 'c_custom', parentId: 'p1', content: `Custom result for ${query}`, metadata: {} },
      ],
    });

    const customKb = new KnowledgeBase({ vectorStore: customStore });
    const customChunks = await customKb.queryChunks('search Codor DB', 1);

    assert(customChunks.length === 1, 'Test 9a: VectorStoreFactory.createCustom integrated with KnowledgeBase');
    assert(customChunks[0].content.includes('Codor DB'), 'Test 9b: Custom vector store closure returned results');

    const pgStore = VectorStoreFactory.createPgVector({
      embeddingProvider: new MockEmbeddingProvider(),
      queryFn: async (vector, limit) => [
        { id: 'c_pg', parentId: 'p1', content: 'PgVector Distance Search Result', metadata: {} },
      ],
    });

    const pgChunks = await pgStore.searchChunks('sql query', 1);
    assert(pgChunks.length === 1, 'Test 9c: VectorStoreFactory.createPgVector executed vector search query');
    assert(pgChunks[0].content.includes('PgVector'), 'Test 9d: PgVector adapter query result returned');
  } catch (err: any) {
    assert(false, 'Test 9: VectorStoreFactory Integration', err.message);
  }

  // TEST 10: AstCodebaseSplitter AST-Aware Code Chunking
  try {
    const { AstCodebaseSplitter } = await import('../src');
    const splitter = new AstCodebaseSplitter({ maxChunkSize: 180, minChunkSize: 10 });

    const sampleTypeScriptCode = `
import type { ModuleRef } from '@nestjs/core';
import * as path from 'path';
import {
  Injectable,
  Optional,
} from '@nestjs/common';
import { ToolPolicy } from './policy.interface';

/**
 * Review options interface documentation
 */
export interface ReviewOptions {
  depth: number;
  strict: boolean;
}

export type ReviewDecision = 'approve' | 'request_changes';

@Injectable()
export class SecurityReviewService {
  public static readonly VERSION = '1.0.0';

  constructor(private readonly policy: ToolPolicy) {}

  public static createInstance(): SecurityReviewService {
    return new SecurityReviewService({} as any);
  }

  get isEnabled(): boolean {
    return true;
  }

  async evaluatePr(prNumber: number): Promise<ReviewDecision> {
    return 'approve';
  }
}

export function formatReviewSummary(decision: ReviewDecision): string {
  return \`Review outcome: \${decision}\`;
}

export const computeChecksum = (data: string): string => {
  return 'chk_123';
};
`;

    const chunks = await splitter.splitDocument({
      id: 'doc_ast_sample',
      title: 'src/security-review.service.ts',
      rawContent: sampleTypeScriptCode,
      chunks: [],
      metadata: { repository: 'nestjs-agentic', nodeType: 'malicious_overwrite' },
    });

    assert(chunks.length >= 6, 'Test 10a: AstCodebaseSplitter parsed code into discrete semantic units');

    const importsChunk = chunks.find((c) => c.metadata.nodeType === 'imports');
    assert(Boolean(importsChunk), 'Test 10b: Extracted imports header block chunk');
    assert(
      (importsChunk?.metadata.importedModules as string[])?.includes('@nestjs/common'),
      'Test 10c: Extracted imported module name @nestjs/common',
    );
    assert(
      (importsChunk?.metadata.importedModules as string[])?.includes('path'),
      'Test 10d: Extracted imported module name path',
    );

    const interfaceChunk = chunks.find((c) => c.metadata.nodeType === 'interface');
    assert(Boolean(interfaceChunk), 'Test 10e: Extracted interface chunk');
    assert(interfaceChunk?.metadata.identifier === 'ReviewOptions', 'Test 10f: Interface identifier ReviewOptions matches');
    assert(interfaceChunk?.metadata.exported === true, 'Test 10g: Interface exported modifier preserved');
    assert(Boolean(interfaceChunk?.content?.includes('Review options interface documentation')), 'Test 10h: JSDoc comment preserved with interface');
    assert(interfaceChunk?.metadata.nodeType === 'interface', 'Test 10i: nodeType was protected from metadata overwrite');

    const typeChunk = chunks.find((c) => c.metadata.nodeType === 'type');
    assert(Boolean(typeChunk), 'Test 10j: Extracted type alias chunk');
    assert(typeChunk?.metadata.identifier === 'ReviewDecision', 'Test 10k: Type identifier ReviewDecision matches');

    const staticMethodChunk = chunks.find((c) => c.metadata.identifier === 'SecurityReviewService.createInstance');
    assert(Boolean(staticMethodChunk), 'Test 10l: Extracted static class method as discrete chunk');
    assert(Boolean(staticMethodChunk?.metadata?.isStatic), 'Test 10m: isStatic metadata flag set on static method');

    const getterChunk = chunks.find((c) => c.metadata.identifier === 'SecurityReviewService.isEnabled');
    assert(Boolean(getterChunk), 'Test 10n: Extracted class getter as discrete chunk');

    const evalMethodChunk = chunks.find((c) => c.metadata.identifier === 'SecurityReviewService.evaluatePr');
    assert(Boolean(evalMethodChunk), 'Test 10o: Extracted instance method evaluatePr');

    const functionChunk = chunks.find((c) => c.metadata.nodeType === 'function' && c.metadata.identifier === 'formatReviewSummary');
    assert(Boolean(functionChunk), 'Test 10p: Extracted function AST chunk');

    const arrowChunk = chunks.find((c) => c.metadata.nodeType === 'function' && c.metadata.identifier === 'computeChecksum');
    assert(Boolean(arrowChunk), 'Test 10q: Extracted arrow function chunk');
  } catch (err: any) {
    assert(false, 'Test 10: AstCodebaseSplitter AST Chunking', err.message);
  }

  // TEST 11: GraphDependencyStrategy Monorepo Package Traversal & Circular Graph Handling
  try {
    const { GraphDependencyStrategy, InMemoryKnowledgeGraphProvider } = await import('../src');
    const graph = new InMemoryKnowledgeGraphProvider();

    // Setup monorepo package & component dependency graph with circular reference
    await graph.addNode({ id: '@nestjs-agentic/core', label: 'Package', properties: { tier: 'core' } });
    await graph.addNode({ id: '@nestjs-agentic/orchestration', label: 'Package', properties: { tier: 'orchestration' } });
    await graph.addNode({ id: '@nestjs-agentic/rag', label: 'Package', properties: { tier: 'rag' } });
    await graph.addNode({ id: 'examples/code-review-agent', label: 'Application', properties: { tier: 'app' } });
    await graph.addNode({ id: 'PrReviewOrchestrator', label: 'Class', properties: { file: 'pr-review.orchestrator.ts' } });

    // Multi-hop + circular edges
    await graph.addEdge({ sourceId: '@nestjs-agentic/orchestration', targetId: '@nestjs-agentic/core', relation: 'DEPENDS_ON' });
    await graph.addEdge({ sourceId: '@nestjs-agentic/rag', targetId: '@nestjs-agentic/core', relation: 'DEPENDS_ON' });
    await graph.addEdge({ sourceId: 'examples/code-review-agent', targetId: '@nestjs-agentic/orchestration', relation: 'DEPENDS_ON' });
    await graph.addEdge({ sourceId: 'PrReviewOrchestrator', targetId: '@nestjs-agentic/orchestration', relation: 'IMPORTS' });
    // Circular link
    await graph.addEdge({ sourceId: '@nestjs-agentic/core', targetId: '@nestjs-agentic/rag', relation: 'OPTIONAL_PEER' });

    const strategy = new GraphDependencyStrategy({
      graphProvider: graph,
      dependencyScoreBoost: 1.5,
      maxDepth: 3,
    });

    const relevantChunk = {
      id: 'chunk_orch_1',
      parentId: 'doc_orch',
      content: 'ParallelSubAgentRunner orchestration fanout logic in @nestjs-agentic/orchestration',
      metadata: { filePath: 'packages/orchestration/src/runners/parallel-subagent.runner.ts' },
    };

    const unrelatedChunk = {
      id: 'chunk_unrelated_2',
      parentId: 'doc_unrelated',
      content: 'Generic helper method with er keyword and import statements',
      metadata: { filePath: 'src/utils/general-helper.ts' },
    };

    const result = await strategy.process({
      query: 'PrReviewOrchestrator @nestjs-agentic/core impact analysis',
      chunks: [relevantChunk, unrelatedChunk],
      scores: { chunk_orch_1: 1.0, chunk_unrelated_2: 1.0 } as any,
    });

    assert(Boolean(result.graphContext), 'Test 11a: GraphDependencyStrategy generated dependency context');
    assert(
      result.graphContext!.includes('DEPENDS_ON') || result.graphContext!.includes('IMPORTS'),
      'Test 11b: Dependency context contains graph relationships',
    );
    assert(
      (result.scores?.get('chunk_orch_1') ?? 0) > 1.0,
      'Test 11c: Impacted dependency chunk score boosted from 1.0 to 1.5',
    );
    assert(
      (result.scores?.get('chunk_unrelated_2') ?? 0) === 1.0,
      'Test 11d: Unrelated chunk without exact word match was NOT false-boosted (1.0)',
    );
    assert(
      result.relationalFacts?.length! > 0,
      'Test 11e: Relational facts array populated for multi-hop reasoning',
    );
  } catch (err: any) {
    assert(false, 'Test 11: GraphDependencyStrategy Package Traversal', err.message);
  }

  // TEST 12: AstCodebaseSplitter High-Throughput Large Codebase Benchmark & Edge Cases
  try {
    const { AstCodebaseSplitter } = await import('../src');
    const splitter = new AstCodebaseSplitter();

    // 12a. Empty and whitespace document handling
    const emptyChunks = await splitter.splitDocument({
      id: 'doc_empty',
      title: 'empty.ts',
      rawContent: '   \n\n  \t ',
      chunks: [],
      metadata: {},
    });
    assert(emptyChunks.length === 0, 'Test 12a: Empty/whitespace document returns empty chunk array gracefully');

    // 12b. 1000+ line large codebase document splitting benchmark
    const largeCodeLines: string[] = [
      "import { Injectable } from '@nestjs/common';",
      "import { ModuleRef } from '@nestjs/core';",
    ];
    for (let i = 0; i < 60; i++) {
      largeCodeLines.push(`
export interface EntityConfig${i} {
  id: string;
  count: number;
}

@Injectable()
export class BenchmarkService${i} {
  public static readonly SVC_ID = ${i};

  async executeTask${i}(param: string): Promise<string> {
    return \`Processed task \${param} on service ${i}\`;
  }
}
      `);
    }

    const largeDocumentText = largeCodeLines.join('\n');
    const startTime = Date.now();
    const largeChunks = await splitter.splitDocument({
      id: 'doc_benchmark_1000_lines',
      title: 'benchmark.service.ts',
      rawContent: largeDocumentText,
      chunks: [],
      metadata: { repository: 'nestjs-agentic-bench' },
    });
    const duration = Date.now() - startTime;

    assert(largeChunks.length >= 100, 'Test 12b: Successfully split 1000+ line codebase into discrete semantic chunks');
    assert(duration < 250, `Test 12c: High throughput splitting completed in ${duration}ms (< 250ms)`);
  } catch (err: any) {
    assert(false, 'Test 12: Large Codebase Benchmark', err.message);
  }

  // TEST 13: reciprocalRankFusion against a hand-computed example (#130)
  try {
    const { reciprocalRankFusion } = await import('../src');

    // k=1 for simple hand-computable numbers.
    // listA rank 1: 'a' -> 1/(1+1) = 0.5, rank 2: 'b' -> 1/(1+2) = 1/3
    // listB rank 1: 'b' -> 1/(1+1) = 0.5, rank 2: 'c' -> 1/(1+2) = 1/3
    // fused: a=0.5, b=1/3+0.5=5/6, c=1/3
    const fused = reciprocalRankFusion([['a', 'b'], ['b', 'c']], { k: 1 });

    assert(Math.abs(fused.get('a')! - 0.5) < 1e-9, 'Test 13a: RRF score for a-only-in-list-1 matches hand-computed 0.5');
    assert(Math.abs(fused.get('b')! - 5 / 6) < 1e-9, 'Test 13b: RRF score for b-in-both-lists matches hand-computed 5/6');
    assert(Math.abs(fused.get('c')! - 1 / 3) < 1e-9, 'Test 13c: RRF score for c-only-in-list-2 matches hand-computed 1/3');
    assert(fused.size === 3, 'Test 13d: fused map contains exactly the union of ids across lists');

    // Per-list weighting: doubling list 1's weight should double its contribution only.
    const weighted = reciprocalRankFusion([['a'], ['a']], { k: 1, weights: [2, 1] });
    assert(Math.abs(weighted.get('a')! - (2 * 0.5 + 1 * 0.5)) < 1e-9, 'Test 13e: per-list weights scale each list\'s contribution independently');
  } catch (err: any) {
    assert(false, 'Test 13: reciprocalRankFusion hand-computed example', err.message);
  }

  // TEST 14: HybridVectorStore fusionMethod: 'rrf' combines BM25 and cosine rankings by rank, not raw score
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const store = new HybridVectorStore({ embeddingProvider: mockEmbed, fusionMethod: 'rrf' });

    await store.addChunks([
      { id: 'rrf_1', parentId: 'd', content: 'quota limit exceeded for tenant', metadata: {} },
      { id: 'rrf_2', parentId: 'd', content: 'unrelated billing notes', metadata: {} },
      { id: 'rrf_3', parentId: 'd', content: 'quota policy overview', metadata: {} },
    ]);

    const results = await store.searchHybridScored('quota limit', 5);
    assert(results.length > 0, 'Test 14a: RRF fusion mode returns results');
    assert(
      results.every((r) => r.score > 0 && r.score <= 2),
      'Test 14b: RRF fusion scores are small rank-based values, not raw cosine/BM25 magnitudes',
    );
    assert(results[0].chunk.id === 'rrf_1', 'Test 14c: chunk ranked first by both BM25 and cosine wins under RRF');
  } catch (err: any) {
    assert(false, 'Test 14: HybridVectorStore RRF fusion integration', err.message);
  }

  // TEST 15: RerankerStrategy minScore filtering and observable failure handling (#132)
  try {
    const chunks = [
      { id: 'r1', parentId: 'p', content: 'high relevance chunk', metadata: {} },
      { id: 'r2', parentId: 'p', content: 'low relevance chunk', metadata: {} },
    ];

    // 15a. minScore drops chunks below the threshold
    const minScoreReranker = new RerankerStrategy({
      rerankFn: async () => [0.9, 0.1],
      minScore: 0.5,
    });
    const filtered = await minScoreReranker.process({ query: 'q', chunks });
    assert(filtered.chunks?.length === 1 && filtered.chunks[0].id === 'r1', 'Test 15a: minScore drops chunks below the threshold post-rerank');

    // 15b. onRerankFailure is invoked when rerankFn throws
    let capturedError: unknown;
    const observedReranker = new RerankerStrategy({
      rerankFn: async () => {
        throw new Error('provider down');
      },
      onRerankFailure: (err) => {
        capturedError = err;
      },
    });
    await observedReranker.process({ query: 'q', chunks });
    assert(capturedError instanceof Error && capturedError.message === 'provider down', 'Test 15b: onRerankFailure receives the thrown error for observability');

    // 15c. onRerankFailureMode: 'throw' propagates instead of silently falling back
    const throwingReranker = new RerankerStrategy({
      rerankFn: async () => {
        throw new Error('provider down');
      },
      onRerankFailureMode: 'throw',
    });
    let threw = false;
    try {
      await throwingReranker.process({ query: 'q', chunks });
    } catch {
      threw = true;
    }
    assert(threw, "Test 15c: onRerankFailureMode: 'throw' propagates the rerankFn error instead of degrading silently");

    // 15d. minScore rejects non-finite values (NaN/Infinity) at construction, per review feedback
    let rejectedNaN = false;
    try {
      new RerankerStrategy({ minScore: NaN });
    } catch {
      rejectedNaN = true;
    }
    assert(rejectedNaN, 'Test 15d: RerankerStrategy rejects a non-finite minScore (NaN) at construction');

    // 15e. A throwing onRerankFailure callback must not mask the original rerankFn error
    // or bypass the configured fallback behavior, per review feedback
    const maskingReranker = new RerankerStrategy({
      rerankFn: async () => {
        throw new Error('original rerank error');
      },
      onRerankFailure: () => {
        throw new Error('callback blew up');
      },
    });
    const maskingResult = await maskingReranker.process({ query: 'q', chunks });
    assert(
      maskingResult.chunks?.length === chunks.length,
      'Test 15e: a throwing onRerankFailure callback does not prevent the fallback path from running',
    );
  } catch (err: any) {
    assert(false, 'Test 15: RerankerStrategy minScore and failure observability', err.message);
  }

  // TEST 16: Built-in Cohere and Voyage rerank provider adapters (#132)
  try {
    const { createCohereRerankProvider, createVoyageRerankProvider } = await import('../src');
    const chunks = [
      { id: 'a', parentId: 'p', content: 'alpha', metadata: {} },
      { id: 'b', parentId: 'p', content: 'beta', metadata: {} },
    ];

    // 16a. Cohere provider maps `results[].index/relevance_score` back to a parallel scores array
    const cohereFetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.8 },
            { index: 0, relevance_score: 0.3 },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const cohereFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: cohereFetch });
    const cohereScores = await cohereFn('q', chunks);
    assert(cohereScores[0] === 0.3 && cohereScores[1] === 0.8, 'Test 16a: Cohere rerank provider maps out-of-order results back to input order');

    // 16b. Voyage provider maps `data[].index/relevance_score` back to a parallel scores array
    const voyageFetch = (async (_url: any, _init: any) =>
      new Response(
        JSON.stringify({
          data: [
            { index: 0, relevance_score: 0.6 },
            { index: 1, relevance_score: 0.9 },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const voyageFn = createVoyageRerankProvider({ apiKey: 'k', fetchFn: voyageFetch });
    const voyageScores = await voyageFn('q', chunks);
    assert(voyageScores[0] === 0.6 && voyageScores[1] === 0.9, 'Test 16b: Voyage rerank provider maps results back to input order');

    // 16c. Non-200 response throws with the status and body surfaced, rather than swallowed
    const failingFetch = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const failingFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: failingFetch });
    let threwOnHttpError = false;
    try {
      await failingFn('q', chunks);
    } catch (e: any) {
      threwOnHttpError = e.message.includes('429') && e.message.includes('rate limited');
    }
    assert(threwOnHttpError, 'Test 16c: non-200 rerank API response throws with status and body surfaced');

    // 16d. Malformed provider responses (out-of-range index) are rejected, not silently
    // misapplied to the wrong chunk, per review feedback
    const malformedFetch = (async () =>
      new Response(JSON.stringify({ results: [{ index: 99, relevance_score: 0.5 }] }), { status: 200 })) as unknown as typeof fetch;
    const malformedFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: malformedFetch });
    let threwOnMalformed = false;
    try {
      await malformedFn('q', chunks);
    } catch {
      threwOnMalformed = true;
    }
    assert(threwOnMalformed, 'Test 16d: an out-of-range index in the provider response is rejected instead of silently applied');

    // 16e. Voyage rejects input exceeding its documented 1,000-document limit before making a request
    const shouldNotBeCalled = (async () => {
      throw new Error('fetchFn must not be called when the document limit is exceeded');
    }) as unknown as typeof fetch;
    const cappedFn = createVoyageRerankProvider({ apiKey: 'k', fetchFn: shouldNotBeCalled });
    const tooManyChunks = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}`, parentId: 'p', content: 'x', metadata: {} }));
    let threwOnTooMany = false;
    try {
      await cappedFn('q', tooManyChunks);
    } catch (e: any) {
      threwOnTooMany = e.message.includes('1000');
    }
    assert(threwOnTooMany, "Test 16e: Voyage provider rejects >1000 documents without calling fetchFn");

    // 16f. Request is aborted after timeoutMs, surfaced as a rejection rather than hanging forever
    const hangingFetch = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
      })) as unknown as typeof fetch;
    const timeoutFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: hangingFetch, timeoutMs: 20 });
    let threwOnTimeout = false;
    try {
      await timeoutFn('q', chunks);
    } catch (e: any) {
      threwOnTimeout = /timed out/i.test(e.message);
    }
    assert(threwOnTimeout, 'Test 16f: a hanging rerank request is aborted after timeoutMs instead of hanging indefinitely');

    // 16g. Incomplete provider results (fewer entries than input chunks) are rejected,
    // instead of silently zero-filling the missing chunks, per review feedback
    const incompleteFetch = (async () =>
      new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), { status: 200 })) as unknown as typeof fetch;
    const incompleteFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: incompleteFetch });
    let threwOnIncomplete = false;
    try {
      await incompleteFn('q', chunks);
    } catch {
      threwOnIncomplete = true;
    }
    assert(threwOnIncomplete, 'Test 16g: a response with fewer results than input chunks is rejected instead of zero-filling the rest');

    // 16h. The abort timer stays armed through body parsing, not just until headers
    // arrive, so a stalled response body is still bounded by timeoutMs, per review feedback
    const stallingBodyFetch = ((_url: any, init: any) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
        }),
        json: async () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
        }),
      })) as unknown as typeof fetch;
    const stallingFn = createCohereRerankProvider({ apiKey: 'k', fetchFn: stallingBodyFetch, timeoutMs: 20 });
    let threwOnStallingBody = false;
    try {
      await stallingFn('q', chunks);
    } catch (e: any) {
      threwOnStallingBody = /timed out/i.test(e.message);
    }
    assert(threwOnStallingBody, 'Test 16h: a stalled response body (headers ok, body hangs) is still bounded by timeoutMs');

    // 16i. Missing/empty API key is rejected at construction with a clear config
    // error, instead of silently sending an empty Bearer credential (review feedback)
    let rejectedEmptyKey = false;
    try {
      createCohereRerankProvider({ apiKey: '', fetchFn: cohereFetch });
    } catch {
      rejectedEmptyKey = true;
    }
    assert(rejectedEmptyKey, 'Test 16i: createCohereRerankProvider rejects a missing/empty API key at construction');

    // 16j. Invalid timeoutMs (negative/NaN) is rejected at construction (review feedback)
    let rejectedBadTimeout = false;
    try {
      createCohereRerankProvider({ apiKey: 'k', timeoutMs: -5 });
    } catch {
      rejectedBadTimeout = true;
    }
    assert(rejectedBadTimeout, 'Test 16j: createCohereRerankProvider rejects a non-positive timeoutMs at construction');

    // 16k. Missing fetch implementation is rejected with a clear config error
    // instead of failing later with an opaque TypeError (review feedback)
    const { resolveFetchFn } = await import('../src');
    const originalFetch = globalThis.fetch;
    // @ts-expect-error - intentionally simulating a runtime without global fetch
    globalThis.fetch = undefined;
    let rejectedNoFetch = false;
    try {
      resolveFetchFn(undefined, 'test');
    } catch {
      rejectedNoFetch = true;
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert(rejectedNoFetch, 'Test 16k: resolveFetchFn rejects when neither fetchFn nor a global fetch is available');
  } catch (err: any) {
    assert(false, 'Test 16: Built-in Cohere/Voyage rerank provider adapters', err.message);
  }

  // TEST 17: MmrStrategy diversity selection (#133)
  try {
    const { MmrStrategy, cosineSimilarity } = await import('../src');

    // 17a. cosineSimilarity utility: known values and edge cases
    assert(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9, 'Test 17a: cosineSimilarity of identical vectors is 1');
    assert(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9, 'Test 17a2: cosineSimilarity of orthogonal vectors is 0');
    assert(cosineSimilarity([1, 0], [1, 0, 0]) === 0, 'Test 17a3: cosineSimilarity of mismatched-length vectors returns 0, not a throw');
    assert(cosineSimilarity([0, 0], [1, 0]) === 0, 'Test 17a4: cosineSimilarity of a zero-magnitude vector returns 0, not NaN');

    // A and B are near-duplicates (identical embedding); C is distinct but lower-scored.
    const chunkA = { id: 'a', parentId: 'p', content: 'auth token validation', metadata: {}, embedding: [1, 0] };
    const chunkB = { id: 'b', parentId: 'p', content: 'auth token validation (near dup)', metadata: {}, embedding: [1, 0] };
    const chunkC = { id: 'c', parentId: 'p', content: 'unrelated billing export', metadata: {}, embedding: [0, 1] };
    const scores = new Map([['a', 0.9], ['b', 0.85], ['c', 0.5]]);

    // 17b. Plain top-K by score would pick A, B (both near-duplicates) — establish the baseline being improved on.
    const plainTopK = [chunkA, chunkB, chunkC].sort((x, y) => scores.get(y.id)! - scores.get(x.id)!).slice(0, 2);
    assert(
      plainTopK.map((c) => c.id).sort().join(',') === 'a,b',
      'Test 17b: baseline top-K by score selects the two near-duplicate chunks (A, B)',
    );

    // 17c. MMR selects A (most relevant) then C (distinct), not A+B, given the near-duplicate penalty
    const mmr = new MmrStrategy({ topK: 2, lambda: 0.5 });
    const mmrResult = mmr.process({ query: 'auth', chunks: [chunkA, chunkB, chunkC], scores });
    const mmrIds = mmrResult.chunks!.map((c) => c.id).sort();
    assert(mmrIds.join(',') === 'a,c', 'Test 17c: MMR selects the relevant chunk plus a distinct one (A, C), surfacing more unique context than plain top-K (A, B)');

    // 17d. lambda close to 1 behaves like pure relevance ranking (ignores diversity)
    const pureRelevance = new MmrStrategy({ topK: 2, lambda: 1 });
    const pureResult = pureRelevance.process({ query: 'auth', chunks: [chunkA, chunkB, chunkC], scores });
    assert(
      pureResult.chunks!.map((c) => c.id).sort().join(',') === 'a,b',
      'Test 17d: lambda=1 (pure relevance) reduces to plain top-K by score, picking A and B',
    );

    // 17e. topK is respected
    const cappedResult = mmr.process({ query: 'auth', chunks: [chunkA, chunkB, chunkC], scores: scores });
    assert(cappedResult.chunks!.length === 2, 'Test 17e: MmrStrategy respects the configured topK');

    // 17f. Chunks without embeddings pass through unchanged (capped at topK), no throw
    const noEmbedChunks = [
      { id: 'x', parentId: 'p', content: 'x', metadata: {} },
      { id: 'y', parentId: 'p', content: 'y', metadata: {} },
    ];
    const noEmbedResult = mmr.process({ query: 'q', chunks: noEmbedChunks });
    assert(noEmbedResult.chunks!.length === 2, 'Test 17f: chunks without embeddings pass through without throwing');

    // 17g. Empty chunks array is a no-op
    const emptyResult = mmr.process({ query: 'q', chunks: [] });
    assert(emptyResult.chunks!.length === 0, 'Test 17g: an empty chunks array is handled without throwing');
  } catch (err: any) {
    assert(false, 'Test 17: MmrStrategy diversity selection', err.message);
  }

  console.log(`\n  📊 Core RAG Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('RAG Unit Tests Failed');
  }

  // Run U-Shaped Context Assembler Strategy Tests
  await runUShapedContextTests();
}

import { runUShapedContextTests } from './u-shaped-context.spec';

if (require.main === module) {
  runRAGTests().catch(() => process.exit(1));
}
