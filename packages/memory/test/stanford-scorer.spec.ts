import {
  GenerativeMemoryStore,
  StanfordMemoryScorer,
  type MemoryRecord,
} from '../src';

export async function runStanfordScorerTests() {
  console.log('⚡ Running Stanford Tri-Factor Memory Retrieval Scoring Tests...\n');

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

  // 1. Recency Decay Calculation
  try {
    const now = new Date('2026-08-18T12:00:00Z');
    const recentRecord: MemoryRecord = {
      id: 'm_recent',
      sessionId: 's1',
      type: 'generative',
      content: 'Just observed',
      timestamp: new Date('2026-08-18T11:59:00Z'), // 1 min ago
    };
    const oldRecord: MemoryRecord = {
      id: 'm_old',
      sessionId: 's1',
      type: 'generative',
      content: 'Observed days ago',
      timestamp: new Date('2026-08-15T12:00:00Z'), // 72 hours ago
    };

    const rRecent = StanfordMemoryScorer.computeRecency(recentRecord, now);
    const rOld = StanfordMemoryScorer.computeRecency(oldRecord, now);

    assert(rRecent > 0.99, 'Recency of 1-minute-old record is near 1.0');
    assert(rOld < rRecent, 'Recency decays over time (72 hours < 1 minute)');
    assert(rOld > 0.0 && rOld < 0.8, 'Old record exhibits smooth exponential decay');

    // Half-life decay option
    const rHalfLife = StanfordMemoryScorer.computeRecency(oldRecord, now, { halfLifeHours: 24 });
    assert(rHalfLife > 0.10 && rHalfLife < 0.20, '24h half-life yields ~0.125 at 72h (1/8th)');
  } catch (err: unknown) {
    assert(false, 'Recency decay calculation', String(err));
  }

  // 2. Importance Scoring
  try {
    const unratedRecord: MemoryRecord = {
      id: 'm_unrated',
      sessionId: 's1',
      type: 'generative',
      content: 'Regular coffee order',
    };
    const highImportanceRecord: MemoryRecord = {
      id: 'm_high',
      sessionId: 's1',
      type: 'generative',
      content: 'Critical security rule: NEVER log plaintext passwords',
      importance: 0.98,
    };
    const scaleTenRecord: MemoryRecord = {
      id: 'm_scale10',
      sessionId: 's1',
      type: 'generative',
      content: 'Database migration rule',
      metadata: { importance: 8.5 },
    };

    assert(StanfordMemoryScorer.computeImportance(unratedRecord) === 0.5, 'Unrated record defaults to 0.5');
    assert(StanfordMemoryScorer.computeImportance(highImportanceRecord) === 0.98, 'Explicit importance 0.98 extracted');
    assert(StanfordMemoryScorer.computeImportance(scaleTenRecord) === 0.85, 'Scale 1..10 normalized to 0.85');
  } catch (err: unknown) {
    assert(false, 'Importance scoring', String(err));
  }

  // 3. Relevance Scoring (Lexical & Embeddings)
  try {
    const textRecord: MemoryRecord = {
      id: 'm_text',
      sessionId: 's1',
      type: 'generative',
      content: 'User prefers dark mode and high contrast text',
    };

    const sExact = StanfordMemoryScorer.computeRelevance(textRecord, 'dark mode');
    const sPartial = StanfordMemoryScorer.computeRelevance(textRecord, 'prefers high contrast layout');
    const sIrrelevant = StanfordMemoryScorer.computeRelevance(textRecord, 'quantum physics equation');

    assert(sExact >= 0.90, 'Exact phrase containment scores high relevance');
    assert(sPartial >= 0.50, 'Token overlap scores proportional relevance');
    assert(sIrrelevant === 0.0, 'Irrelevant query scores 0 relevance');

    // Vector cosine similarity
    const vecRecord: MemoryRecord = {
      id: 'm_vec',
      sessionId: 's1',
      type: 'generative',
      content: 'Semantic embedding memory',
      embedding: [1, 0, 0],
    };
    const sVecMatch = StanfordMemoryScorer.computeRelevance(vecRecord, 'query', [1, 0, 0]);
    const sVecOrthogonal = StanfordMemoryScorer.computeRelevance(vecRecord, 'query', [0, 1, 0]);

    assert(sVecMatch === 1.0, 'Identical embedding vector yields cosine 1.0');
    assert(sVecOrthogonal === 0.0, 'Orthogonal embedding vector yields cosine 0.0');
  } catch (err: unknown) {
    assert(false, 'Relevance scoring', String(err));
  }

  // 4. Tri-Factor Composite Ranking & Min-Max Normalization
  try {
    const now = new Date('2026-08-18T12:00:00Z');
    const candidates: MemoryRecord[] = [
      {
        id: 'c1_recent_trivial',
        sessionId: 's1',
        type: 'generative',
        content: 'I had tea today',
        importance: 0.1,
        timestamp: new Date('2026-08-18T11:55:00Z'), // very recent
      },
      {
        id: 'c2_old_critical_rule',
        sessionId: 's1',
        type: 'generative',
        content: 'CRITICAL: Database password must be rotated every 30 days',
        importance: 0.95,
        timestamp: new Date('2026-08-10T12:00:00Z'), // 8 days old
      },
      {
        id: 'c3_recent_relevant',
        sessionId: 's1',
        type: 'generative',
        content: 'Database password rotation scheduled for tomorrow',
        importance: 0.85,
        timestamp: new Date('2026-08-18T11:00:00Z'), // 1 hour old
      },
    ];

    const ranked = StanfordMemoryScorer.rankCandidates(candidates, 'database password rotation', {
      now,
      weights: { recency: 0.3, importance: 0.3, relevance: 0.4 },
    });

    assert(ranked.length === 3, 'All candidates scored');
    assert(ranked[0].record.id === 'c3_recent_relevant', 'Top ranked is both relevant and recent');
    assert(
      ranked[1].record.id === 'c2_old_critical_rule',
      'Old critical rule ranks above recent trivial tea chatter',
    );
    assert(ranked[2].record.id === 'c1_recent_trivial', 'Trivial chatter ranks last despite recency');
  } catch (err: unknown) {
    assert(false, 'Tri-Factor composite ranking', String(err));
  }

  // 5. Edge Cases: Empty pool, Identical scores, Query longer than record
  try {
    // Edge case 1: Empty candidates
    const emptyRanked = StanfordMemoryScorer.rankCandidates([], 'any query');
    assert(emptyRanked.length === 0, 'Edge Case 1: Empty candidates pool returns empty array');

    // Edge case 2: Zero variance across pool (identical importance & recency)
    const fixedTime = new Date('2026-08-18T10:00:00Z');
    const identicalCandidates: MemoryRecord[] = [
      { id: 'i1', sessionId: 's', type: 'generative', content: 'Same content A', importance: 0.8, timestamp: fixedTime },
      { id: 'i2', sessionId: 's', type: 'generative', content: 'Same content B', importance: 0.8, timestamp: fixedTime },
    ];
    const zeroVarRanked = StanfordMemoryScorer.rankCandidates(identicalCandidates, 'Same content', { now: fixedTime });
    assert(zeroVarRanked.length === 2, 'Edge Case 2a: Zero-variance pool handled without NaN');
    assert(!Number.isNaN(zeroVarRanked[0].score), 'Edge Case 2b: Calculated score is valid number');

    // Edge case 3: Query much longer than stored memory
    const shortRecord: MemoryRecord = { id: 'short', sessionId: 's', type: 'generative', content: 'redis' };
    const longQueryRel = StanfordMemoryScorer.computeRelevance(
      shortRecord,
      'How do I configure the cluster node settings and persistence volume for an enterprise distributed redis cache backend in Kubernetes?',
    );
    assert(longQueryRel > 0.0, 'Edge Case 3: Long query matching short keyword scores positive relevance');
  } catch (err: unknown) {
    assert(false, 'Edge Cases', String(err));
  }

  // 6. GenerativeMemoryStore with embedFn
  try {
    const mockEmbedFn = async (text: string): Promise<number[]> => {
      if (text.includes('database') || text.includes('sql')) return [1, 0, 0];
      if (text.includes('ui') || text.includes('theme')) return [0, 1, 0];
      return [0, 0, 1];
    };

    const store = new GenerativeMemoryStore({ embedFn: mockEmbedFn });
    await store.save({
      id: 'emb_1',
      sessionId: 'sess_emb',
      type: 'generative',
      content: 'PostgreSQL database replica configuration',
    });
    await store.save({
      id: 'emb_2',
      sessionId: 'sess_emb',
      type: 'generative',
      content: 'Dark mode user interface styling',
    });

    const recalled = await store.recall('sql query performance', { sessionId: 'sess_emb' });
    assert(recalled[0].id === 'emb_1', 'GenerativeMemoryStore with embedFn automatically computes vectors and retrieves semantic match');
  } catch (err: unknown) {
    assert(false, 'GenerativeMemoryStore with embedFn', String(err));
  }

  // 7. GenerativeMemoryStore Integration & Score Breakdowns
  try {
    const store = new GenerativeMemoryStore();
    const sessionId = 'sess_gen_1';

    await store.save({
      id: 'g1',
      sessionId,
      type: 'generative',
      content: 'User requested dark mode theme for admin dashboard',
      importance: 0.8,
    });
    await store.save({
      id: 'g2',
      sessionId,
      type: 'generative',
      content: 'Weather in San Francisco is foggy',
      importance: 0.2,
    });
    await store.save({
      id: 'g3',
      sessionId,
      type: 'generative',
      content: 'Admin dashboard permissions: requires role "superuser"',
      importance: 0.95,
    });

    const recalled = await store.recall('admin dashboard', { sessionId, limit: 2 });
    assert(recalled.length === 2, 'Recalls top 2 records');
    assert(recalled[0].id === 'g3' || recalled[0].id === 'g1', 'Top recalled items are dashboard-related');

    const scoredRecalled = await store.recallScored('admin dashboard', { sessionId });
    assert(scoredRecalled.length === 3, 'recallScored returns all items with scores');
    assert(scoredRecalled[0].score >= scoredRecalled[1].score, 'Results sorted descending by score');
    assert(scoredRecalled[0].recencyScore !== undefined, 'Recency component present in breakdown');
    assert(scoredRecalled[0].importanceScore !== undefined, 'Importance component present in breakdown');
    assert(scoredRecalled[0].relevanceScore !== undefined, 'Relevance component present in breakdown');

    // Min score cutoff filter
    const filtered = await store.recall('admin dashboard', { sessionId, minScoreCutoff: 0.6 });
    assert(filtered.every((r) => r.id !== 'g2'), 'Irrelevant/low-score items filtered by minScoreCutoff');
  } catch (err: unknown) {
    assert(false, 'GenerativeMemoryStore integration', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} Stanford memory scorer test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} Stanford Tri-Factor Memory Scorer tests passed successfully.\n`);
}
