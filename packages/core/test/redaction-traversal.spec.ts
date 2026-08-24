import { traverseAndRedact } from '../src/utils/redaction-traversal';

export async function runRedactionTraversalTests() {
  console.log('🧬 Running traverseAndRedact Tests (Shared Redaction Traversal)...\n');

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

  const upper = (s: string) => s.toUpperCase();

  // TEST 1: safe defaults — forbidden keys skipped and reported as a modification
  try {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "note": "x"}');
    const { value, modified } = traverseAndRedact(malicious, { maxDepth: 10, transformString: upper });
    assert(({} as any).polluted === undefined, 'Test 1a: global Object.prototype not polluted (default skipForbiddenKeys)');
    assert(!Object.prototype.hasOwnProperty.call(value, 'polluted'), 'Test 1b: forbidden key dropped from the clone by default');
    assert(modified === true, 'Test 1c: dropping a forbidden key is reported as a modification');
  } catch (err: any) {
    assert(false, 'Test 1: safe defaults', err.message);
  }

  // TEST 2: forbidden keys can be cloned through with an explicit opt-out
  try {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "note": "x"}');
    const { value: skipOff } = traverseAndRedact(
      malicious,
      { maxDepth: 10, transformString: upper, skipForbiddenKeys: false },
    );
    assert(
      Object.prototype.hasOwnProperty.call(skipOff, '__proto__') || (skipOff as any).polluted === true,
      'Test 2a: skipForbiddenKeys: false clones the forbidden key through (explicit opt-out)',
    );
  } catch (err: any) {
    assert(false, 'Test 2: forbidden key opt-out', err.message);
  }

  // TEST 3: onDepthExceeded 'passthrough' (default) vs 'deny'
  try {
    const deep = { a: { b: { c: 'leaf' } } };

    const passthrough = traverseAndRedact(deep, { maxDepth: 1, transformString: upper });
    assert(passthrough.depthExceeded === false, 'Test 3a: default onDepthExceeded does not report depthExceeded');

    const deny = traverseAndRedact(deep, { maxDepth: 1, transformString: upper, onDepthExceeded: 'deny' });
    assert(deny.depthExceeded === true, 'Test 3b: onDepthExceeded "deny" reports depthExceeded past the limit');
  } catch (err: any) {
    assert(false, 'Test 3: depth-exceeded behavior modes', err.message);
  }

  // TEST 4: circular arrays are handled without infinite recursion
  try {
    const arr: any[] = ['leaf'];
    arr.push(arr);
    const { value, modified } = traverseAndRedact(arr, { maxDepth: 10, transformString: upper });
    assert(modified === true, 'Test 4a: string leaf inside a circular array is transformed');
    assert((value as any[])[1] === value, 'Test 4b: circular array reference resolves to the cloned array itself');
  } catch (err: any) {
    assert(false, 'Test 4: circular array safety', err.message);
  }

  // TEST 5: a null-prototype input object is treated as a plain record
  try {
    const nullProtoObj = Object.create(null);
    nullProtoObj.note = 'leaf';
    const { value, modified } = traverseAndRedact(nullProtoObj, { maxDepth: 10, transformString: upper });
    assert(modified === true, 'Test 5a: null-prototype object is traversed as a plain record');
    assert((value as any).note === 'LEAF', 'Test 5b: its string leaf is transformed');
  } catch (err: any) {
    assert(false, 'Test 5: null-prototype record handling', err.message);
  }

  // TEST 6: handleKey overrides generic traversal for any value type
  try {
    const result = traverseAndRedact(
      { secret: { nested: 'value' }, other: 'x' },
      {
        maxDepth: 10,
        transformString: upper,
        handleKey: (key) => (key === 'secret' ? { handled: true, value: '[MASKED]' } : { handled: false }),
      },
    );
    assert((result.value as any).secret === '[MASKED]', 'Test 6a: handleKey masks an object-valued key wholesale');
    assert((result.value as any).other === 'X', 'Test 6b: keys without an override still go through generic traversal');
  } catch (err: any) {
    assert(false, 'Test 6: handleKey override', err.message);
  }

  // TEST 7: type-aware handling — Date/RegExp preserved, Map/Set/class inspected + type-preserved
  try {
    class Money {
      constructor(public label: string) {}
    }
    const now = new Date();
    const input = {
      ts: now,
      pattern: /abc/gi,
      lookup: new Map([['k', 'secret']]),
      tags: new Set(['secret']),
      money: new Money('secret'),
    };

    const { value, modified } = traverseAndRedact(input, { maxDepth: 20, transformString: upper });
    const out = value as any;

    assert(out.ts instanceof Date && out.ts.getTime() === now.getTime(), 'Test 7a: Date preserved unchanged');
    assert(out.pattern instanceof RegExp && out.pattern.source === 'abc', 'Test 7b: RegExp preserved unchanged');
    assert(out.lookup instanceof Map && out.lookup.get('k') === 'SECRET', 'Test 7c: Map type preserved AND its values inspected/transformed');
    assert(out.tags instanceof Set && out.tags.has('SECRET'), 'Test 7d: Set type preserved AND its members inspected/transformed');
    assert(out.money instanceof Money && out.money.label === 'SECRET', 'Test 7e: class instance keeps its prototype AND its string fields are inspected');
    assert(modified === true, 'Test 7f: inspecting inside Map/Set/class counts as a modification');
  } catch (err: any) {
    assert(false, 'Test 7: type-aware container handling', err.message);
  }

  console.log(`\n  📊 traverseAndRedact Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('traverseAndRedact Unit Tests Failed');
  }
}

if (require.main === module) {
  runRedactionTraversalTests().catch(() => process.exit(1));
}
