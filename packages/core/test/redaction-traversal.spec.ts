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

  // TEST 1: safe defaults — forbidden keys skipped, non-plain preserved
  try {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "note": "x"}');
    const { value } = traverseAndRedact(malicious, { maxDepth: 10, transformString: upper });
    assert(({} as any).polluted === undefined, 'Test 1a: global Object.prototype not polluted (default skipForbiddenKeys)');
    assert(!Object.prototype.hasOwnProperty.call(value, 'polluted'), 'Test 1b: forbidden key dropped from the clone by default');

    const now = new Date();
    const { value: withDate } = traverseAndRedact({ ts: now }, { maxDepth: 10, transformString: upper });
    assert((withDate as any).ts instanceof Date, 'Test 1c: Date preserved by default (default preserveNonPlainObjects)');
  } catch (err: any) {
    assert(false, 'Test 1: safe defaults', err.message);
  }

  // TEST 2: opting out of safe defaults restores legacy behavior
  try {
    const now = new Date();
    const { value } = traverseAndRedact(
      { ts: now },
      { maxDepth: 10, transformString: upper, preserveNonPlainObjects: false },
    );
    assert(!((value as any).ts instanceof Date), 'Test 2a: preserveNonPlainObjects: false clones Date into a plain object (legacy opt-in)');

    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "note": "x"}');
    const { value: skipOff } = traverseAndRedact(
      malicious,
      { maxDepth: 10, transformString: upper, skipForbiddenKeys: false },
    );
    assert(
      Object.prototype.hasOwnProperty.call(skipOff, '__proto__') || (skipOff as any).polluted === true,
      'Test 2b: skipForbiddenKeys: false clones the forbidden key through (explicit opt-out)',
    );
  } catch (err: any) {
    assert(false, 'Test 2: opting out of safe defaults', err.message);
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

  console.log(`\n  📊 traverseAndRedact Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('traverseAndRedact Unit Tests Failed');
  }
}

if (require.main === module) {
  runRedactionTraversalTests().catch(() => process.exit(1));
}
