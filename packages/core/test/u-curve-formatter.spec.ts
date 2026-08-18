import {
  UCurveContextFormatter,
  type UCurvePromptSection,
} from '../src';

export async function runUCurveFormatterTests() {
  console.log('⚡ Running UCurveContextFormatter Tests (Prompt Attention Structuring)...\n');

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

  // 1. Basic U-Curve Section Priority Ordering
  try {
    const sections: UCurvePromptSection[] = [
      {
        id: 'user_task',
        title: 'Immediate User Request',
        content: 'Refactor UserService to use dependency injection',
        priority: 'critical_recency',
      },
      {
        id: 'reference_docs',
        title: 'NestJS Modules Reference',
        content: 'Modules are classes annotated with @Module() decorator...',
        priority: 'medium_reference',
      },
      {
        id: 'security_invariant',
        title: 'Governance & Security Invariant',
        content: 'CRITICAL: Never bypass TenantIsolationPolicy under any circumstances.',
        priority: 'critical_primacy',
      },
      {
        id: 'available_tools',
        title: 'Available Tools',
        content: 'Tool: readFile, Tool: writeFile, Tool: runCommand',
        priority: 'high',
      },
    ];

    const assembled = UCurveContextFormatter.assemblePrompt(sections, {
      sectionSeparator: '\n\n',
    });

    const lines = assembled.split('\n\n');

    assert(
      lines[0].includes('Governance & Security Invariant'),
      'Test 1a: Critical Primacy section placed at the very top (Primacy Edge)',
    );
    assert(
      lines[1].includes('Available Tools'),
      'Test 1b: High priority section placed second (High Primacy)',
    );
    assert(
      lines[2].includes('NestJS Modules Reference'),
      'Test 1c: Medium reference section placed in the center (Middle Valley)',
    );
    assert(
      lines[3].includes('Immediate User Request'),
      'Test 1d: Critical Recency section placed at the very bottom (Recency Edge)',
    );
  } catch (err: unknown) {
    assert(false, 'Test 1: Section Priority Ordering', String(err));
  }

  // 2. Secondary Order Tie-Breaking within Same Priority
  try {
    const sections: UCurvePromptSection[] = [
      { id: 'p2', content: 'Second Primacy Rule', priority: 'critical_primacy', order: 2 },
      { id: 'p1', content: 'First Primacy Rule', priority: 'critical_primacy', order: 1 },
      { id: 'r2', content: 'Second Recency Directive', priority: 'critical_recency', order: 2 },
      { id: 'r1', content: 'First Recency Directive', priority: 'critical_recency', order: 1 },
    ];

    const prompt = UCurveContextFormatter.assemblePrompt(sections, { renderTitles: false });
    const parts = prompt.split('\n\n');

    assert(parts[0] === 'First Primacy Rule', 'Test 2a: Order tie-breaker 1 appears first in Primacy');
    assert(parts[1] === 'Second Primacy Rule', 'Test 2b: Order tie-breaker 2 appears second in Primacy');
    assert(parts[2] === 'First Recency Directive', 'Test 2c: Order tie-breaker 1 appears first in Recency');
    assert(parts[3] === 'Second Recency Directive', 'Test 2d: Order tie-breaker 2 appears second in Recency');
  } catch (err: unknown) {
    assert(false, 'Test 2: Order Tie-Breaking', String(err));
  }

  // 3. Global Header and Footer Injection
  try {
    const sections: UCurvePromptSection[] = [
      { id: 'c1', content: 'Core instruction', priority: 'high' },
    ];

    const prompt = UCurveContextFormatter.assemblePrompt(sections, {
      globalHeader: '# Agent Prompt Header',
      globalFooter: '# End of Prompt',
      renderTitles: false,
    });

    assert(prompt.startsWith('# Agent Prompt Header'), 'Test 3a: Global header prepended');
    assert(prompt.endsWith('# End of Prompt'), 'Test 3b: Global footer appended');
    assert(prompt.includes('Core instruction'), 'Test 3c: Body content preserved');
  } catch (err: unknown) {
    assert(false, 'Test 3: Header and Footer', String(err));
  }

  // 4. Empty and Whitespace Filtering
  try {
    const emptyPrompt = UCurveContextFormatter.assemblePrompt([]);
    assert(emptyPrompt === '', 'Test 4a: Empty sections array returns empty string');

    const whitespaceSections: UCurvePromptSection[] = [
      { content: '   ', priority: 'critical_primacy' },
      { content: 'Valid content', priority: 'high' },
      { content: '', priority: 'critical_recency' },
    ];
    const cleaned = UCurveContextFormatter.assemblePrompt(whitespaceSections, { renderTitles: false });
    assert(cleaned === 'Valid content', 'Test 4b: Empty and whitespace-only sections filtered out');
  } catch (err: unknown) {
    assert(false, 'Test 4: Empty filtering', String(err));
  }

  // 5. Generic reorderToUCurve() with Numeric Scores
  try {
    interface RankedItem {
      id: string;
      score: number;
    }

    const items: RankedItem[] = [
      { id: 'item_1', score: 0.95 },
      { id: 'item_2', score: 0.85 },
      { id: 'item_3', score: 0.70 },
      { id: 'item_4', score: 0.50 },
      { id: 'item_5', score: 0.30 },
    ];

    const primacyReordered = UCurveContextFormatter.reorderToUCurve(
      items,
      (it) => it.score,
      'primacy_first',
    );

    // Expected order: [item_1 (0.95), item_3 (0.70), item_5 (0.30), item_4 (0.50), item_2 (0.85)]
    assert(primacyReordered[0].id === 'item_1', 'Test 5a: #1 item at top (Primacy)');
    assert(primacyReordered[4].id === 'item_2', 'Test 5b: #2 item at bottom (Recency)');
    assert(primacyReordered[2].id === 'item_5', 'Test 5c: #5 (lowest score) item in center valley');

    const recencyReordered = UCurveContextFormatter.reorderToUCurve(
      items,
      (it) => it.score,
      'recency_first',
    );

    // Expected order: [item_2 (0.85), item_4 (0.50), item_5 (0.30), item_3 (0.70), item_1 (0.95)]
    assert(recencyReordered[4].id === 'item_1', 'Test 5d: Recency-first puts #1 item at bottom');
    assert(recencyReordered[0].id === 'item_2', 'Test 5e: Recency-first puts #2 item at top');
    assert(recencyReordered[2].id === 'item_5', 'Test 5f: Recency-first puts lowest item in center');

    // N=2 Boundary Test
    const twoItems: RankedItem[] = [
      { id: 'top', score: 1.0 },
      { id: 'second', score: 0.5 },
    ];
    const primacyTwo = UCurveContextFormatter.reorderToUCurve(twoItems, (i) => i.score, 'primacy_first');
    assert(primacyTwo[0].id === 'top' && primacyTwo[1].id === 'second', 'Test 5g: N=2 primacy-first puts top item at index 0');

    const recencyTwo = UCurveContextFormatter.reorderToUCurve(twoItems, (i) => i.score, 'recency_first');
    assert(recencyTwo[0].id === 'second' && recencyTwo[1].id === 'top', 'Test 5h: N=2 recency-first puts top item at index 1');
  } catch (err: unknown) {
    assert(false, 'Test 5: reorderToUCurve()', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} UCurveContextFormatter test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} UCurveContextFormatter tests passed successfully.\n`);
}

if (require.main === module) {
  runUCurveFormatterTests().catch(() => process.exit(1));
}
