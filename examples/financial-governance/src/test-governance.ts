import { Test } from '@nestjs/testing';
import { AgentRunner, ApprovalService, MockRuntimeAdapter, RUNTIME_ADAPTER } from 'nestjs-agentic';
import type { AgentStreamEvent, ToolExecutionResult } from 'nestjs-agentic';
import {
  CompositeMemory,
  EpisodicMemory,
  ScratchpadMemory,
  SemanticMemory,
  ShortTermMemory,
} from '@nestjs-agentic/memory';
import { ExperienceLearner } from '@nestjs-agentic/experience';
import {
  ContextualCompressionStrategy,
  GraphRAGStrategy,
  HierarchicalRAGStrategy,
  InMemoryKnowledgeGraphProvider,
  KnowledgeBase,
  LateChunkingStrategy,
  MockEmbeddingProvider,
  ParentChildHydrationStrategy,
  ParentChildSplitter,
  QueryExpansionStrategy,
  RAGPipeline,
  RerankerStrategy,
} from '@nestjs-agentic/rag';
import { AppModule } from './app.module';

async function runTests() {
  console.log('🧪 Starting Financial Governance Integration Tests...\n');

  const mockAdapter = new MockRuntimeAdapter();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RUNTIME_ADAPTER)
    .useValue(mockAdapter)
    .compile();

  const runner = moduleRef.get(AgentRunner);
  const approvalService = moduleRef.get(ApprovalService);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Low-risk transfer ($500) -> Allowed
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $500 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 500 });

    const result = await runner.run('banking-agent', {
      sessionId: 's1',
      message: 'Transfer $500 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_safe',
        tenantId: 'acme_corp',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isSuccess = res && res.success === true;
    assert(isSuccess, 'Test 1: Low-risk transfer ($500) is auto-allowed');
  } catch (err: any) {
    assert(false, 'Test 1: Low-risk transfer', err.message);
  }

  // TEST 2: High-risk role failure ($6,000 without finance_officer role) -> Denied
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $6000 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 6000 });

    const result = await runner.run('banking-agent', {
      sessionId: 's2',
      message: 'Transfer $6000 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_regular',
        tenantId: 'acme_corp',
        roles: ['regular_user'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isDenied = res && res.success === false && res.status === 'denied';
    const reason = isDenied ? res.reason : '';
    assert(
      isDenied && reason.includes('finance_officer'),
      'Test 2: High-amount transfer without finance_officer role is denied',
      `Reason: ${reason}`,
    );
  } catch (err: any) {
    assert(false, 'Test 2: Role failure', err.message);
  }

  // TEST 3: Suspended Tenant -> Denied
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $100 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 100 });

    const result = await runner.run('banking-agent', {
      sessionId: 's3',
      message: 'Transfer $100 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_safe',
        tenantId: 'suspended_tenant',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isDenied = res && res.success === false && res.status === 'denied';
    assert(isDenied, 'Test 3: Suspended tenant transfer is denied by TenantIsolationPolicy');
  } catch (err: any) {
    assert(false, 'Test 3: Suspended Tenant', err.message);
  }

  // TEST 4: High-Value Transfer ($25,000) -> Pending Approval & Approval Lifecycle
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $25000 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 25000 });

    const result = await runner.run('banking-agent', {
      sessionId: 's4',
      message: 'Transfer $25000 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_mgr',
        tenantId: 'acme_corp',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isPending = res && res.success === false && res.status === 'pending_approval';
    const approvalId = isPending ? res.approvalId : undefined;

    assert(
      isPending && Boolean(approvalId),
      'Test 4a: Transfer of $25,000 triggers HITL pending_approval state',
      `approvalId: ${approvalId}`,
    );

    if (approvalId) {
      const approvalResult = await approvalService.approve(approvalId);
      assert(
        approvalResult.success === true,
        'Test 4b: Human Approval executing pending tool closure succeeds',
      );
    }
  } catch (err: any) {
    assert(false, 'Test 4: HITL Approval Lifecycle', err.message);
  }

  // TEST 5: Structured Event Streaming (runStream)
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Stream transfer $500')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 500 });

    const streamEvents: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('banking-agent', {
      sessionId: 's5_stream',
      message: 'Stream transfer $500',
      context: {
        userId: 'usr_safe',
        tenantId: 'acme_corp',
        roles: ['finance_officer'],
      },
    })) {
      streamEvents.push(event);
    }

    assert(
      streamEvents.length >= 3,
      'Test 5a: runStream() emitted structured stream events for financial transfer',
    );
    assert(
      streamEvents[0].type === 'tool_start' && streamEvents[0].toolName === 'transferFunds',
      'Test 5b: Event stream emitted "tool_start" with tool name transferFunds',
    );
    assert(
      streamEvents[streamEvents.length - 1].type === 'complete',
      'Test 5c: Event stream completed with final "complete" status event',
    );
  } catch (err: any) {
    assert(false, 'Test 5: Structured Event Streaming', err.message);
  }

  // TEST 6: Multi-tier Memory Store Integration (ShortTerm, Scratchpad, Semantic, Episodic)
  try {
    const shortTerm = new ShortTermMemory({ maxMessages: 5 });
    const scratchpad = new ScratchpadMemory();
    const semantic = new SemanticMemory();
    const episodic = new EpisodicMemory();
    const compositeMemory = new CompositeMemory([shortTerm, scratchpad, semantic, episodic]);

    const sessMemId = 's6_memory_session';

    // Record session conversation message
    await compositeMemory.save({
      id: 'msg_101',
      sessionId: sessMemId,
      type: 'short_term',
      content: 'User requested high-value ledger transfer audit',
    });

    // Record working task in Scratchpad
    await compositeMemory.save({
      id: 'task_audit_01',
      sessionId: sessMemId,
      type: 'scratchpad',
      content: 'Pending audit for ACC-1 transfer',
      metadata: { taskId: 'task_audit_01', priority: 'high' },
    });

    // Record semantic fact
    await compositeMemory.save({
      id: 'sem_audit_01',
      sessionId: sessMemId,
      type: 'semantic',
      content: 'Account ACC-1 audit policy belongs to Acme Corp logistics division',
    });

    // Record episodic event
    await compositeMemory.save({
      id: 'ep_audit_01',
      sessionId: sessMemId,
      type: 'episodic',
      content: 'Agent completed audit verification for ACC-1',
    });

    const recalled = await compositeMemory.recall('audit', { sessionId: sessMemId });

    assert(recalled.length >= 3, 'Test 6a: CompositeMemory recalled items across multi-tier memory stores');
    assert(
      recalled.some((r) => r.type === 'short_term'),
      'Test 6b: ShortTermMemory message retrieved in recall query',
    );
    assert(
      recalled.some((r) => r.type === 'scratchpad'),
      'Test 6c: ScratchpadMemory task retrieved in recall query',
    );
    assert(
      recalled.some((r) => r.type === 'semantic'),
      'Test 6d: SemanticMemory fact retrieved in recall query',
    );
    assert(
      recalled.some((r) => r.type === 'episodic'),
      'Test 6e: EpisodicMemory event retrieved in recall query',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Multi-tier Memory Store Integration', err.message);
  }

  // TEST 7: Real Experience Reflexion & Learning Loop
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $10000 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 10000 });

    const runResult = await runner.run('banking-agent', {
      sessionId: 'sess_exp_test',
      message: 'Transfer $10000 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_unauthorized',
        tenantId: 'acme_corp',
        roles: ['guest'],
      },
    });

    const memory = new EpisodicMemory();
    const learner = new ExperienceLearner({ memoryStore: memory });

    // Step 1: Agent trajectory failed due to role policy denial
    const failedToolResult = runResult.toolCalls[0]?.result as Record<string, unknown> | undefined;
    const errReason = (typeof failedToolResult?.reason === 'string' ? failedToolResult.reason : undefined) ?? 'Role failure: finance_officer required';

    // Step 2: Experience Learner critiques trajectory & records learned lesson
    const reflection = await learner.critiqueTrajectory({
      sessionId: 'sess_exp_test',
      agentName: 'banking-agent',
      goal: 'Financial Transfer',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'transferFunds',
          error: errReason,
        },
      ],
    });

    assert(reflection.success === false, 'Test 7a: Experience engine critiqued failed trajectory');
    assert(
      reflection.lessonsLearned.some((l: string) => l.includes('finance_officer')),
      'Test 7b: Experience engine extracted role authorization lesson',
    );

    // Step 3: Next execution retrieves historical prompt guidance
    const guidancePrompt = await learner.buildGuidancePrompt('Financial Transfer', 'sess_exp_test');

    assert(
      guidancePrompt.includes('finance_officer'),
      'Test 7c: Prompt guidance generated for future self-correcting agent runs',
    );
  } catch (err: any) {
    assert(false, 'Test 7: Experience Reflexion & Learning', err.message);
  }

  // TEST 8: Comprehensive @nestjs-agentic/rag Modular Strategies Suite
  try {
    const mockEmbed = new MockEmbeddingProvider();
    const kb = new KnowledgeBase();
    await kb.ingestDocument({
      title: 'Transfer Policy',
      rawContent: '# Approvals\nWire transfer operations over $10,000 require manager approval.',
    });

    // 8a. QueryExpansionStrategy
    const expander = new QueryExpansionStrategy({ synonymsMap: { wire: ['payment'] } });
    const expandCtx = await expander.process({ query: 'wire transfer' });
    assert(
      Boolean(expandCtx.expandedQueries?.includes('payment transfer')),
      'Test 8a: QueryExpansionStrategy successfully injected synonym variations into expandedQueries',
    );

    // 8b. HierarchicalRAGStrategy
    const hierarchical = new HierarchicalRAGStrategy();
    const chunks = await kb.queryChunks('manager approval', 1);
    const hierarchyCtx = await hierarchical.process({ query: 'test', chunks });
    assert(
      Boolean(hierarchyCtx.hierarchicalTree && hierarchyCtx.hierarchicalTree.length > 0),
      'Test 8b: HierarchicalRAGStrategy generated node tree from markdown headers',
    );

    // 8c. ParentChildHydrationStrategy
    const hydration = new ParentChildHydrationStrategy();
    chunks[0].metadata = { parentText: 'PARENT_DOC_TEXT' };
    const hydrateCtx = await hydration.process({ query: 'test', chunks });
    assert(
      Boolean(hydrateCtx.hydratedParentContext?.includes('PARENT_DOC_TEXT')),
      'Test 8c: ParentChildHydrationStrategy hydrated raw parent text into context',
    );

    // 8d. LateChunkingStrategy
    const lateChunking = new LateChunkingStrategy({ embeddingProvider: mockEmbed });
    const lateCtx = await lateChunking.process({ query: 'test', chunks });
    assert(
      Boolean(lateCtx.chunks?.[0]?.metadata?.lateChunkingApplied),
      'Test 8d: LateChunkingStrategy successfully blended vectors and marked chunk metadata',
    );

    // 8e. ContextualCompressionStrategy
    const compression = new ContextualCompressionStrategy({ maxCharacters: 10 });
    const compCtx = await compression.process({ query: 'test', hydratedParentContext: 'This is a very long text that must be truncated.' });
    assert(
      compCtx.compressedContext!.length < 50,
      'Test 8e: ContextualCompressionStrategy successfully truncated lengthy context via extractive boundaries',
    );

    // 8f. RerankerStrategy (Cross-Encoder Mock)
    const reranker = new RerankerStrategy({ rerankFn: async () => [0.99] });
    const rerankCtx = await reranker.process({ query: 'test', chunks, scores: new Map([[chunks[0].id, 0.1]]) });
    assert(
      rerankCtx.scores!.get(chunks[0].id) === 0.99,
      'Test 8f: RerankerStrategy successfully applied custom Cross-Encoder rerankFn scores',
    );

    // 8g. GraphRAGStrategy
    const graph = new InMemoryKnowledgeGraphProvider();
    await graph.addNode({ id: 'usr_ceo', label: 'User', properties: { role: 'CEO' } });
    await graph.addNode({ id: 'org_acme', label: 'Tenant', properties: {} });
    await graph.addEdge({ sourceId: 'usr_ceo', targetId: 'org_acme', relation: 'MANAGES' });
    const graphRAG = new GraphRAGStrategy({ graphProvider: graph });
    const graphCtx = await graphRAG.process({ query: 'usr_ceo org_acme' });
    assert(
      Boolean(graphCtx.graphContext) && graphCtx.graphContext!.includes('MANAGES'),
      'Test 8g: GraphRAGStrategy successfully queried sub-graph and injected relational facts (MANAGES)',
    );
  } catch (err: any) {
    assert(false, 'Test 8: RAG Modular Strategies Suite', err.message);
  }

  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
