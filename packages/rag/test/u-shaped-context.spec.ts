import {
  UShapedContextStrategy,
  type DocumentChunk,
  type RAGContext,
} from '../src';

export async function runUShapedContextTests() {
  console.log('⚡ Running UShapedContextStrategy Tests (Lost-in-the-Middle Mitigation)...\n');

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

  // 1. Alternating U-curve reorder (Primacy First)
  try {
    const items = ['c1_rank1', 'c2_rank2', 'c3_rank3', 'c4_rank4', 'c5_rank5'];
    const reordered = UShapedContextStrategy.reorder(items, 'primacy_first');

    // Expected: [c1, c3, c5, c4, c2]
    assert(reordered.length === 5, 'Primacy-first preserves item count');
    assert(reordered[0] === 'c1_rank1', '#1 ranked item placed at Top (Highest Primacy)');
    assert(reordered[4] === 'c2_rank2', '#2 ranked item placed at Bottom (Highest Recency)');
    assert(reordered[1] === 'c3_rank3', '#3 ranked item placed at Second-from-Top');
    assert(reordered[3] === 'c4_rank4', '#4 ranked item placed at Second-from-Bottom');
    assert(reordered[2] === 'c5_rank5', '#5 (lowest ranked) item placed in dead center (Middle Valley)');
  } catch (err: unknown) {
    assert(false, 'Primacy First reorder', String(err));
  }

  // 2. Alternating U-curve reorder (Recency First)
  try {
    const items = ['c1_rank1', 'c2_rank2', 'c3_rank3', 'c4_rank4', 'c5_rank5'];
    const reordered = UShapedContextStrategy.reorder(items, 'recency_first');

    // Expected: [c2, c4, c5, c3, c1]
    assert(reordered[4] === 'c1_rank1', 'Recency-first places #1 ranked item at very Bottom');
    assert(reordered[0] === 'c2_rank2', 'Recency-first places #2 ranked item at Top');
    assert(reordered[2] === 'c5_rank5', 'Recency-first places lowest ranked in center');
  } catch (err: unknown) {
    assert(false, 'Recency First reorder', String(err));
  }

  // 3. Edge Cases: Empty, Single, Two, and Even Count (N=4, N=6)
  try {
    assert(UShapedContextStrategy.reorder([]).length === 0, 'Empty array returns empty array');
    assert(UShapedContextStrategy.reorder(['single'])[0] === 'single', 'Single item preserved');

    const twoItems = ['a', 'b'];
    const reorderedTwo = UShapedContextStrategy.reorder(twoItems);
    assert(reorderedTwo[0] === 'a' && reorderedTwo[1] === 'b', 'Two items preserved');

    // Even count (N=4): [c1, c2, c3, c4] -> [c1, c3, c4, c2]
    const fourItems = ['1', '2', '3', '4'];
    const reorderedFour = UShapedContextStrategy.reorder(fourItems, 'primacy_first');
    assert(
      reorderedFour[0] === '1' &&
        reorderedFour[1] === '3' &&
        reorderedFour[2] === '4' &&
        reorderedFour[3] === '2',
      'Even count N=4 alternating sequence correct: [1, 3, 4, 2]',
    );

    // Even count (N=6): [1, 2, 3, 4, 5, 6] -> [1, 3, 5, 6, 4, 2]
    const sixItems = ['1', '2', '3', '4', '5', '6'];
    const reorderedSix = UShapedContextStrategy.reorder(sixItems, 'primacy_first');
    assert(
      reorderedSix[0] === '1' &&
        reorderedSix[1] === '3' &&
        reorderedSix[2] === '5' &&
        reorderedSix[3] === '6' &&
        reorderedSix[4] === '4' &&
        reorderedSix[5] === '2',
      'Even count N=6 alternating sequence correct: [1, 3, 5, 6, 4, 2]',
    );
  } catch (err: unknown) {
    assert(false, 'Edge cases and even counts', String(err));
  }

  // 4. UShapedContextStrategy.process() Integration with RAGContext
  try {
    const strategy = new UShapedContextStrategy({
      placementStrategy: 'primacy_first',
      header: '=== Retrieved Context References ===',
      footer: '=== End of References ===',
    });

    const chunks: DocumentChunk[] = [
      { id: 'ch_low', parentId: 'doc1', content: 'Low priority fact', metadata: { title: 'Low Doc' } },
      { id: 'ch_high', parentId: 'doc1', content: 'CRITICAL SECURITY INVARIANT: No plain keys', metadata: { title: 'Security Doc' } },
      { id: 'ch_med', parentId: 'doc1', content: 'Medium priority instruction', metadata: { title: 'Instruction Doc' } },
    ];

    const scores = new Map<string, number>([
      ['ch_low', 0.2],
      ['ch_high', 0.95],
      ['ch_med', 0.75],
    ]);

    const context: RAGContext = {
      query: 'security rules',
      chunks,
      scores,
    };

    const processed = strategy.process(context);

    assert(processed.chunks !== undefined, 'Chunks array present in processed context');
    assert(processed.chunks![0].id === 'ch_high', 'Top chunk is highest scored (ch_high)');
    assert(processed.chunks![2].id === 'ch_med', 'Bottom chunk is second highest scored (ch_med)');
    assert(processed.chunks![1].id === 'ch_low', 'Middle chunk is lowest scored (ch_low)');

    assert(processed.compressedContext !== undefined, 'compressedContext generated');
    assert(processed.compressedContext!.includes('=== Retrieved Context References ==='), 'Header included');
    assert(processed.compressedContext!.includes('CRITICAL SECURITY INVARIANT'), 'Critical content included');
    assert(processed.compressedContext!.includes('=== End of References ==='), 'Footer included');
    assert(processed.metadata?.uShapeApplied === true, 'uShapeApplied metadata flag marked');
  } catch (err: unknown) {
    assert(false, 'UShapedContextStrategy.process() integration', String(err));
  }

  // 5. maxChunks truncation before U-shape distribution
  try {
    const strategy = new UShapedContextStrategy({
      maxChunks: 3,
    });

    const chunks: DocumentChunk[] = [
      { id: '1', parentId: 'd', content: '1', metadata: {} },
      { id: '2', parentId: 'd', content: '2', metadata: {} },
      { id: '3', parentId: 'd', content: '3', metadata: {} },
      { id: '4', parentId: 'd', content: '4', metadata: {} },
      { id: '5', parentId: 'd', content: '5', metadata: {} },
    ];

    const processed = strategy.process({ query: 'test', chunks });
    assert(processed.chunks?.length === 3, 'maxChunks truncated chunks to 3');
    assert(processed.chunks?.[0].id === '1', 'Truncated U-curve top is 1');
    assert(processed.chunks?.[2].id === '2', 'Truncated U-curve bottom is 2');
    assert(processed.chunks?.[1].id === '3', 'Truncated U-curve center is 3');
  } catch (err: unknown) {
    assert(false, 'maxChunks truncation', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} UShapedContextStrategy test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} UShapedContextStrategy tests passed successfully.\n`);
}
