import { HybridVectorStore, KnowledgeBase, RAGPipeline } from '@nestjs-agentic/rag';
import {
  FaithfulnessMetric,
  HitRateAtKMetric,
  NdcgAtKMetric,
  PrecisionAtKMetric,
  rankedIds,
  RecallAtKMetric,
  ReciprocalRankMetric,
  RetrievalBenchmarkRunner,
} from '../src';
import type {
  FaithfulnessJudgeInput,
  RetrievalContext,
  RetrievalEvalDatasetItem,
  RetrievedChunk,
} from '../src';

const chunk = (id: string, parentId = `doc_${id}`, content = `content of ${id}`): RetrievedChunk => ({
  id,
  parentId,
  content,
  metadata: {},
});

/** Ranked a, b, c, d, e by chunk order. */
const ORDERED: RetrievalContext = { query: 'q', chunks: ['a', 'b', 'c', 'd', 'e'].map((id) => chunk(id)) };

const item = (overrides: Partial<RetrievalEvalDatasetItem> = {}): RetrievalEvalDatasetItem => ({
  id: 'q1',
  query: 'q',
  relevantIds: ['a', 'c', 'x'],
  ...overrides,
});

export async function runRetrievalMetricsTests() {
  console.log('🔎 Running Retrieval-Quality Metrics Tests...\n');
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

  // TEST 1: ranking follows scores when present, chunk order otherwise
  try {
    const scored: RetrievalContext = {
      query: 'q',
      chunks: [chunk('x'), chunk('y'), chunk('z'), chunk('w')],
      scores: new Map([['x', 0.1], ['y', 0.9], ['z', 0.5], ['w', 0.5]]),
    };
    assert(rankedIds(scored).join(',') === 'y,z,w,x', 'Test 1a: Scores rank highest first, ties keep chunk order', rankedIds(scored).join(','));
    assert(rankedIds(ORDERED).join(',') === 'a,b,c,d,e', 'Test 1b: Without scores the chunk order is the rank');

    const byDoc: RetrievalContext = { query: 'q', chunks: [chunk('c1', 'p1'), chunk('c2', 'p1'), chunk('c3', 'p2')] };
    assert(rankedIds(byDoc, 'parentId').join(',') === 'p1,p2', 'Test 1c: parentId matching collapses chunks to documents in rank order');
  } catch (err: any) {
    assert(false, 'Test 1: Ranking', err.message);
  }

  // TEST 2: cutoff metrics on hand-computed values
  try {
    const recall = new RecallAtKMetric({ k: 3 }).evaluate(item(), ORDERED);
    assert(recall.metricName === 'Recall@3' && recall.score === 0.6667, 'Test 2a: Recall@3 = 2 of 3 relevant found', String(recall.score));
    assert(recall.passed, 'Test 2b: …which passes the default 0.5 threshold');

    const precision = new PrecisionAtKMetric({ k: 3 }).evaluate(item(), ORDERED);
    assert(precision.score === 0.6667, 'Test 2c: Precision@3 = 2 relevant of 3 slots', String(precision.score));

    const short: RetrievalContext = { query: 'q', chunks: [chunk('a')] };
    const precision5 = new PrecisionAtKMetric({ k: 5 }).evaluate(item(), short);
    assert(precision5.score === 0.2, 'Test 2d: Precision@k divides by k, so short result lists are not rewarded', String(precision5.score));

    const miss = new HitRateAtKMetric({ k: 1 }).evaluate(item({ relevantIds: ['b'] }), ORDERED);
    assert(miss.metricName === 'HitRate@1' && miss.score === 0, 'Test 2e: HitRate@1 misses when the relevant id is second');
    assert(new HitRateAtKMetric({ k: 2 }).evaluate(item({ relevantIds: ['b'] }), ORDERED).score === 1, 'Test 2f: HitRate@2 hits it');
  } catch (err: any) {
    assert(false, 'Test 2: Cutoff metrics', err.message);
  }

  // TEST 3: reciprocal rank
  try {
    const rr = new ReciprocalRankMetric().evaluate(item({ relevantIds: ['c'] }), ORDERED);
    assert(rr.metricName === 'MRR' && rr.score === 0.3333 && rr.details?.firstRelevantRank === 3, 'Test 3a: First relevant at rank 3 gives 1/3', String(rr.score));
    const capped = new ReciprocalRankMetric({ k: 2 }).evaluate(item({ relevantIds: ['c'] }), ORDERED);
    assert(capped.metricName === 'MRR@2' && capped.score === 0, 'Test 3b: MRR@k ignores ranks past k');
    const none = new ReciprocalRankMetric().evaluate(item({ relevantIds: ['zz'] }), ORDERED);
    assert(none.score === 0 && !none.passed, 'Test 3c: No relevant result scores 0');
  } catch (err: any) {
    assert(false, 'Test 3: Reciprocal rank', err.message);
  }

  // TEST 4: nDCG with graded relevance
  try {
    const ranked: RetrievalContext = { query: 'q', chunks: ['b', 'a', 'c'].map((id) => chunk(id)) };
    const graded = item({ relevantIds: ['a', 'c'], relevanceGrades: { a: 3, c: 1 } });
    // DCG = 7/log2(3) + 1/log2(4) = 4.4165 + 0.5; ideal = 7/log2(2) + 1/log2(3) = 7.6309
    const ndcg = new NdcgAtKMetric({ k: 3 }).evaluate(graded, ranked);
    assert(ndcg.score === 0.6443, 'Test 4a: nDCG@3 matches the hand-computed value', String(ndcg.score));

    const ideal: RetrievalContext = { query: 'q', chunks: ['a', 'c', 'b'].map((id) => chunk(id)) };
    assert(new NdcgAtKMetric({ k: 3 }).evaluate(graded, ideal).score === 1, 'Test 4b: The ideal ordering scores 1');

    const binary = new NdcgAtKMetric({ k: 5 }).evaluate(item(), ORDERED);
    // DCG = 1 + 1/log2(4) = 1.5; ideal over 3 relevant = 1 + 1/log2(3) + 1/log2(4) = 2.1309
    assert(binary.score === 0.7039, 'Test 4c: Binary relevance uses gain 1 per relevant id', String(binary.score));
  } catch (err: any) {
    assert(false, 'Test 4: nDCG', err.message);
  }

  // TEST 5: guards
  try {
    const unlabeled = new RecallAtKMetric({ k: 3 }).evaluate(item({ relevantIds: [] }), ORDERED);
    assert(!unlabeled.passed && unlabeled.score === 0 && Boolean(unlabeled.reason?.includes('no relevantIds')), 'Test 5a: An unlabeled item fails rather than scoring 1');
    let threw = false;
    try {
      new RecallAtKMetric({ k: 0 });
    } catch {
      threw = true;
    }
    assert(threw, 'Test 5b: k must be a positive integer');
    const strict = new RecallAtKMetric({ k: 3, threshold: 0.9 }).evaluate(item(), ORDERED);
    assert(!strict.passed, 'Test 5c: The pass threshold is configurable');
  } catch (err: any) {
    assert(false, 'Test 5: Guards', err.message);
  }

  // TEST 6: faithfulness delegates to the judge with ranked contexts
  try {
    const seen: FaithfulnessJudgeInput[] = [];
    const metric = new FaithfulnessMetric(
      (input) => {
        seen.push(input);
        return { score: input.answer.includes('refund') ? 0.9 : 0.2, reason: 'judged' };
      },
      { maxContexts: 2 },
    );
    const scoredContext: RetrievalContext = {
      query: 'q',
      chunks: [chunk('a', 'd', 'low'), chunk('b', 'd', 'high')],
      scores: new Map([['a', 0.1], ['b', 0.9]]),
    };
    const grounded = await metric.evaluate(item({ expectedAnswer: 'Refunds take 5 days.' }), scoredContext, 'A refund takes 5 days.');
    assert(grounded.passed && grounded.score === 0.9, 'Test 6a: The judge score is used');
    assert(
      seen[0].contexts.join('|') === 'high|low' && seen[0].expectedAnswer === 'Refunds take 5 days.',
      'Test 6b: The judge receives passages in relevance order, plus the reference answer',
      seen[0].contexts.join('|'),
    );
    const noAnswer = await metric.evaluate(item(), scoredContext);
    assert(!noAnswer.passed && Boolean(noAnswer.reason?.includes('answer')), 'Test 6c: Without an answer the metric fails and says why');
    const broken = await new FaithfulnessMetric(() => ({ score: NaN, reason: '' })).evaluate(item(), scoredContext, 'x');
    assert(!broken.passed && Boolean(broken.reason?.includes('finite')), 'Test 6d: A non-finite judge score fails the metric');
  } catch (err: any) {
    assert(false, 'Test 6: Faithfulness', err.message);
  }

  // TEST 7: the runner aggregates over a dataset
  try {
    const index: Record<string, string[]> = { refunds: ['a', 'b', 'c'], shipping: ['d', 'e', 'f'], broken: [] };
    const runner = new RetrievalBenchmarkRunner(
      (query) => {
        if (query === 'broken') throw new Error('vector store down');
        return { query, chunks: (index[query] ?? []).map((id) => chunk(id)) };
      },
      { topK: 3 },
    );
    const summary = await runner.run([
      item({ id: 'r', query: 'refunds', relevantIds: ['a'] }),
      item({ id: 's', query: 'shipping', relevantIds: ['f'] }),
      item({ id: 'b', query: 'broken', relevantIds: ['a'] }),
    ]);
    assert(
      Object.keys(summary.metricAverages).join(',') === 'Recall@3,Precision@3,MRR,nDCG@3',
      'Test 7a: Default metrics use the runner topK',
      Object.keys(summary.metricAverages).join(','),
    );
    // Reciprocal ranks 1, 1/3, 0 (failed retrieval)
    assert(summary.metricAverages.MRR === 0.4444, 'Test 7b: MRR is the mean reciprocal rank across items', String(summary.metricAverages.MRR));
    assert(summary.itemResults[0].retrievedIds.join(',') === 'a,b,c', 'Test 7c: Each item records its ranked ids');
    const failedItem = summary.itemResults[2];
    assert(
      failedItem.error === 'vector store down' && failedItem.score === 0 && !failedItem.overallPassed,
      'Test 7d: A retrieval failure scores the item 0 instead of aborting the benchmark',
    );
    assert(summary.totalItems === 3 && summary.failedItems >= 1, 'Test 7e: Totals are reported');
  } catch (err: any) {
    assert(false, 'Test 7: Runner aggregation', err.message);
  }

  // TEST 8: real KnowledgeBase and RAGPipeline, with document-level ground truth
  try {
    const kb = new KnowledgeBase({ vectorStore: new HybridVectorStore({ vectorWeight: 0 }) });
    await kb.ingestDocument({ id: 'refund-policy', title: 'Refunds', rawContent: 'Refunds are issued within five business days of approval.' });
    await kb.ingestDocument({ id: 'shipping-policy', title: 'Shipping', rawContent: 'Orders ship within two days by courier.' });
    await kb.ingestDocument({ id: 'privacy-policy', title: 'Privacy', rawContent: 'We never sell personal data to third parties.' });

    const dataset = [
      item({ id: 'refund', query: 'how long do refunds take', relevantIds: ['refund-policy'] }),
      item({ id: 'ship', query: 'when do orders ship', relevantIds: ['shipping-policy'] }),
    ];

    const fromKb = await new RetrievalBenchmarkRunner(kb, { topK: 3, matchOn: 'parentId' }).run(dataset);
    assert(
      fromKb.metricAverages.MRR === 1 && fromKb.itemResults[0].retrievedIds[0] === 'refund-policy',
      'Test 8a: A KnowledgeBase is evaluated directly, ranking the right document first',
      JSON.stringify(fromKb.itemResults.map((r) => r.retrievedIds)),
    );

    const pipeline = new RAGPipeline({ knowledgeBase: kb });
    const answers: string[] = [];
    const fromPipeline = await new RetrievalBenchmarkRunner(pipeline, {
      topK: 3,
      matchOn: 'parentId',
      answer: (_item, context) => {
        const top = rankedIds(context)[0];
        const text = context.chunks?.find((c) => c.id === top)?.content ?? '';
        answers.push(text);
        return text;
      },
      metrics: [
        new ReciprocalRankMetric({ matchOn: 'parentId' }),
        new FaithfulnessMetric(({ answer, contexts }) => ({
          score: contexts.some((c) => c.includes(answer)) ? 1 : 0,
          reason: 'answer quoted from context',
        })),
      ],
    }).run(dataset);
    assert(
      fromPipeline.metricAverages.MRR === 1 && fromPipeline.metricAverages.Faithfulness === 1 && answers.length === 2,
      'Test 8b: A RAGPipeline is evaluated end to end, answer generation included',
      JSON.stringify(fromPipeline.metricAverages),
    );
  } catch (err: any) {
    assert(false, 'Test 8: RAG integration', err.message);
  }

  console.log(`\n  📊 Retrieval Metrics Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Retrieval metrics tests failed');
  }
}
