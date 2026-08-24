import { PiiRedactionPolicy } from '../src';
import type { AgentContext } from '../src';

export async function runPiiRedactionTests() {
  console.log('🕵️ Running PiiRedactionPolicy Tests (PII Detection & Redaction)...\n');

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

  const dummyCtx: AgentContext = {
    sessionId: 'sess_pii',
    traceId: 'trace_pii',
    security: { userId: 'usr_support', tenantId: 'acme' },
  };

  // TEST 1: evaluate() always allows (pure Output Rail)
  try {
    const policy = new PiiRedactionPolicy();
    const result = await policy.evaluate(dummyCtx, 'anyTool', {});
    assert(result.decision === 'allow', 'Test 1: evaluate() always allows');
  } catch (err: any) {
    assert(false, 'Test 1: evaluate() always allows', err.message);
  }

  // TEST 2: Email address redaction
  try {
    const policy = new PiiRedactionPolicy();
    const output = 'Contact the customer at jane.doe+support@example.co.uk for follow-up.';
    const result = await policy.evaluateOutput(dummyCtx, 'fetchTicket', output);

    assert(result.decision === 'sanitize', 'Test 2a: output containing an email is flagged for sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('jane.doe+support@example.co.uk'), 'Test 2b: email address is removed');
      assert(sanitized.includes('[REDACTED_EMAIL]'), 'Test 2c: email placeholder is applied');
    }
  } catch (err: any) {
    assert(false, 'Test 2: email address redaction', err.message);
  }

  // TEST 3: Phone number redaction (NANP and international)
  try {
    const policy = new PiiRedactionPolicy();
    const output = 'Call the customer at (415) 555-0132 or +44 20 7946 0958.';
    const result = await policy.evaluateOutput(dummyCtx, 'fetchTicket', output);

    assert(result.decision === 'sanitize', 'Test 3a: output containing phone numbers is flagged');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('415) 555-0132'), 'Test 3b: NANP phone number is redacted');
      assert(!sanitized.includes('20 7946 0958'), 'Test 3c: international phone number is redacted');
      assert(sanitized.includes('[REDACTED_PHONE]'), 'Test 3d: phone placeholder is applied');
    }
  } catch (err: any) {
    assert(false, 'Test 3: phone number redaction', err.message);
  }

  // TEST 4: Credit card redaction is Luhn-validated (true positive + false positive avoidance)
  try {
    const policy = new PiiRedactionPolicy();

    // Valid Luhn test numbers (well-known test card numbers, not real accounts).
    const validCard = 'Card on file: 4111 1111 1111 1111.';
    const validResult = await policy.evaluateOutput(dummyCtx, 'fetchCard', validCard);
    assert(validResult.decision === 'sanitize', 'Test 4a: a Luhn-valid 16-digit card number is flagged');
    if (validResult.decision === 'sanitize') {
      const sanitized = validResult.sanitizedResult as string;
      assert(!sanitized.includes('4111 1111 1111 1111'), 'Test 4b: valid card number is redacted');
      assert(sanitized.includes('[REDACTED_CREDIT_CARD]'), 'Test 4c: credit card placeholder is applied');
    }

    // A 16-digit run that fails the Luhn checksum must NOT be flagged as a card number,
    // per the issue's explicit false-positive requirement.
    const invalidCard = 'Reference number: 4111 1111 1111 1112.';
    const invalidResult = await policy.evaluateOutput(dummyCtx, 'fetchCard', invalidCard);
    assert(
      invalidResult.decision === 'allow',
      'Test 4d: a 16-digit number that fails Luhn is NOT flagged as a credit card (false-positive avoidance)',
    );
  } catch (err: any) {
    assert(false, 'Test 4: credit card Luhn validation', err.message);
  }

  // TEST 5: US SSN redaction
  try {
    const policy = new PiiRedactionPolicy();
    const output = 'SSN on file: 219-09-9999.';
    const result = await policy.evaluateOutput(dummyCtx, 'fetchProfile', output);

    assert(result.decision === 'sanitize', 'Test 5a: output containing an SSN is flagged');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('219-09-9999'), 'Test 5b: SSN is redacted');
      assert(sanitized.includes('[REDACTED_SSN]'), 'Test 5c: SSN placeholder is applied');
    }

    // A bare 9-digit run without dashes is deliberately NOT treated as an SSN
    // (too many false positives: invoice numbers, order IDs, etc).
    const bareDigits = 'Order reference: 219099999.';
    const bareResult = await policy.evaluateOutput(dummyCtx, 'fetchProfile', bareDigits);
    assert(
      bareResult.decision === 'allow',
      'Test 5d: an unformatted 9-digit run is not misclassified as an SSN',
    );
  } catch (err: any) {
    assert(false, 'Test 5: SSN redaction', err.message);
  }

  // TEST 6: Each category is independently toggleable
  try {
    const emailOnly = new PiiRedactionPolicy({
      redactEmail: true,
      redactPhone: false,
      redactCreditCard: false,
      redactSsn: false,
    });

    const mixed = 'Email jane@example.com, phone (415) 555-0132, card 4111 1111 1111 1111, ssn 219-09-9999.';
    const result = await emailOnly.evaluateOutput(dummyCtx, 'fetchAll', mixed);

    assert(result.decision === 'sanitize', 'Test 6a: at least the email is redacted');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('jane@example.com'), 'Test 6b: email is redacted when enabled');
      assert(sanitized.includes('(415) 555-0132'), 'Test 6c: phone is preserved when disabled');
      assert(sanitized.includes('4111 1111 1111 1111'), 'Test 6d: credit card is preserved when disabled');
      assert(sanitized.includes('219-09-9999'), 'Test 6e: SSN is preserved when disabled');
    }
  } catch (err: any) {
    assert(false, 'Test 6: independently toggleable categories', err.message);
  }

  // TEST 7: Object traversal masks sensitive keys and non-sensitive fields are preserved
  try {
    const policy = new PiiRedactionPolicy({ sensitiveKeys: ['homeAddress'] });
    const customer = {
      username: 'agent_user',
      email: 'user@example.com',
      homeAddress: '123 Main St, Springfield',
      profile: {
        phone: '(212) 555-0100',
      },
    };

    const result = await policy.evaluateOutput(dummyCtx, 'getCustomer', customer);
    assert(result.decision === 'sanitize', 'Test 7a: object with PII fields is sanitized');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as any;
      assert(sanitized.username === 'agent_user', 'Test 7b: non-PII field preserved');
      assert(sanitized.email === '[REDACTED_EMAIL]', 'Test 7c: nested-in-object email is redacted');
      assert(sanitized.homeAddress === '[REDACTED_PII]', 'Test 7d: custom sensitiveKey is masked wholesale');
      assert(sanitized.profile.phone === '[REDACTED_PHONE]', 'Test 7e: nested phone is redacted');
    }
  } catch (err: any) {
    assert(false, 'Test 7: object traversal and sensitive keys', err.message);
  }

  // TEST 8: Clean output is allowed without modification
  try {
    const policy = new PiiRedactionPolicy();
    const result = await policy.evaluateOutput(dummyCtx, 'getStatus', { status: 'ok', count: 42 });
    assert(result.decision === 'allow', 'Test 8: clean output with no PII is allowed unmodified');
  } catch (err: any) {
    assert(false, 'Test 8: clean output allowed', err.message);
  }

  // TEST 9: Circular reference safety (shares traversal with SecretRedactionPolicy)
  try {
    const policy = new PiiRedactionPolicy();
    const circular: any = { contact: 'reach me at test@example.com' };
    circular.self = circular;

    const result = await policy.evaluateOutput(dummyCtx, 'getGraph', circular);
    assert(result.decision === 'sanitize', 'Test 9a: circular object processed without stack overflow');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as any;
      assert(sanitized.self === sanitized, 'Test 9b: circular reference points to the sanitized clone');
      assert(!sanitized.contact.includes('test@example.com'), 'Test 9c: circular object content still sanitized');
    }
  } catch (err: any) {
    assert(false, 'Test 9: circular reference safety', err.message);
  }

  // TEST 10: Custom patterns and custom mask placeholder
  try {
    const policy = new PiiRedactionPolicy({
      customPatterns: [/EMP-\d{6}/g],
      maskPlaceholder: '[PII]',
      redactPhone: false,
      redactCreditCard: false,
      redactSsn: false,
    });

    const output = 'Employee id EMP-482910, contact jane@example.com';
    const result = await policy.evaluateOutput(dummyCtx, 'fetchEmployee', output);
    assert(result.decision === 'sanitize', 'Test 10a: custom pattern match triggers sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('EMP-482910'), 'Test 10b: custom pattern is redacted');
      assert(sanitized.includes('[PII]'), 'Test 10c: custom mask placeholder is used for all categories');
      assert(!sanitized.includes('jane@example.com'), 'Test 10d: built-in email pattern still applies alongside custom pattern');
    }
  } catch (err: any) {
    assert(false, 'Test 10: custom patterns and placeholder', err.message);
  }

  // TEST 11: A sensitive key holding a structured (non-string) value is masked wholesale
  try {
    const policy = new PiiRedactionPolicy({ sensitiveKeys: ['homeAddress'] });
    const customer = {
      username: 'agent_user',
      // A sensitive key can hold an object, not just a string — must still be
      // masked wholesale rather than recursed into.
      homeAddress: { street: '123 Main St', city: 'Springfield', zip: '62704' },
      contacts: {
        homeAddress: ['123 Main St', 'Springfield'],
      },
    };

    const result = await policy.evaluateOutput(dummyCtx, 'getCustomer', customer);
    assert(result.decision === 'sanitize', 'Test 11a: object-valued sensitive key triggers sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as any;
      assert(sanitized.username === 'agent_user', 'Test 11b: non-sensitive field preserved');
      assert(sanitized.homeAddress === '[REDACTED_PII]', 'Test 11c: object-valued sensitive key masked wholesale, not recursed into');
      assert(sanitized.contacts.homeAddress === '[REDACTED_PII]', 'Test 11d: array-valued sensitive key nested in an object is also masked wholesale');
    }
  } catch (err: any) {
    assert(false, 'Test 11: sensitive key masks non-string values wholesale', err.message);
  }

  // TEST 12: Output nested deeper than maxDepth is denied, never silently allowed
  try {
    const shallowPolicy = new PiiRedactionPolicy({ maxDepth: 1 });
    // Email is buried below the depth limit; a naive impl would return it unchecked.
    const deep = { level1: { level2: { email: 'buried@example.com' } } };

    const result = await shallowPolicy.evaluateOutput(dummyCtx, 'fetchDeep', deep);
    assert(result.decision === 'deny', 'Test 12a: output deeper than maxDepth is denied, never allowed unexamined');
    if (result.decision === 'deny') {
      assert(result.reason.includes('depth'), 'Test 12b: denial reason explains the depth limit');
    }
  } catch (err: any) {
    assert(false, 'Test 12: maxDepth exceeded fails closed', err.message);
  }

  // TEST 13: Prototype-polluting keys are neutralized during cloning
  try {
    const policy = new PiiRedactionPolicy();
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "email": "test@example.com"}');

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecord', malicious);
    assert(({} as Record<string, unknown>).polluted === undefined, 'Test 13a: global Object.prototype is not polluted');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as Record<string, unknown>;
      assert(
        Object.getPrototypeOf(sanitized) !== malicious.__proto__,
        'Test 13b: the sanitized clone\'s own prototype was not reassigned from the input\'s __proto__ key',
      );
      assert(!Object.prototype.hasOwnProperty.call(sanitized, 'polluted'), 'Test 13c: the forbidden key does not appear as an own property either');
    }
  } catch (err: any) {
    assert(false, 'Test 13: prototype-pollution safety', err.message);
  }

  // TEST 14: Rebuildable containers (Map/Set) are redacted; Date is preserved
  try {
    const policy = new PiiRedactionPolicy();
    const now = new Date();
    const output = {
      createdAt: now, // opaque value type: preserved, carries no PII
      tags: new Set(['vip', 'jane@example.com']),
      lookup: new Map([['primary', 'reach me at bob@example.com']]),
    };

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecord', output);
    assert(result.decision === 'sanitize', 'Test 14a: object with PII inside Map/Set is sanitized');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as typeof output;
      assert(sanitized.createdAt instanceof Date && sanitized.createdAt.getTime() === now.getTime(), 'Test 14b: Date value preserved, not corrupted');
      assert(sanitized.tags instanceof Set, 'Test 14c: Set type preserved');
      assert(!sanitized.tags.has('jane@example.com') && sanitized.tags.has('vip'), 'Test 14d: PII inside a Set is redacted, non-PII member kept');
      assert(sanitized.lookup instanceof Map, 'Test 14e: Map type preserved');
      assert(!String(sanitized.lookup.get('primary')).includes('bob@example.com'), 'Test 14f: PII inside a Map value is redacted');
      assert(sanitized.lookup.has('primary'), 'Test 14g: a non-PII Map key is left intact so lookups still work');
    }
  } catch (err: any) {
    assert(false, 'Test 14: rebuildable container redaction', err.message);
  }

  // TEST 22: PII inside a class instance is detected and denied (never silently
  // forwarded, and never rewritten into a structurally broken clone)
  try {
    const policy = new PiiRedactionPolicy();
    class Contact {
      constructor(public email: string) {}
      greet() {
        return `hi ${this.email}`;
      }
    }

    const withPii = await policy.evaluateOutput(dummyCtx, 'fetchRecord', {
      contact: new Contact('carol@example.com'),
    });
    assert(withPii.decision === 'deny', 'Test 22a: PII inside a class instance fails closed (deny)');
    if (withPii.decision === 'deny') {
      assert(
        withPii.reason.toLowerCase().includes('cannot be safely redacted'),
        'Test 22b: the denial explains that the value cannot be safely redacted',
      );
    }

    // A clean class instance is preserved untouched — instanceof and methods survive.
    const clean = await policy.evaluateOutput(dummyCtx, 'fetchRecord', {
      contact: new Contact('not-an-email'),
      note: 'reach me at dave@example.com',
    });
    assert(clean.decision === 'sanitize', 'Test 22c: a clean class instance alongside redactable PII still sanitizes');
    if (clean.decision === 'sanitize') {
      const sanitized = clean.sanitizedResult as { contact: Contact; note: string };
      assert(sanitized.contact instanceof Contact, 'Test 22d: a clean class instance keeps its prototype');
      assert(typeof sanitized.contact.greet === 'function', 'Test 22e: its methods still work');
      assert(!sanitized.note.includes('dave@example.com'), 'Test 22f: sibling PII is still redacted');
    }

    // A built-in (URL) holding PII is likewise denied rather than broken.
    const builtIn = await policy.evaluateOutput(dummyCtx, 'fetchRecord', {
      link: new URL('https://example.com/?contact=erin@example.com'),
    });
    assert(builtIn.decision === 'deny', 'Test 22g: PII inside a platform built-in (URL) also fails closed');
  } catch (err: any) {
    assert(false, 'Test 22: class-instance / built-in detect-and-deny', err.message);
  }

  // TEST 23: cloning never triggers an inherited prototype setter
  try {
    let setterCalls = 0;
    class Trap {
      private _v = 'clean';
      set label(v: string) {
        setterCalls++;
        this._v = v;
      }
      get label() {
        return this._v;
      }
    }

    const policy = new PiiRedactionPolicy();
    const instance = new Trap();
    await policy.evaluateOutput(dummyCtx, 'fetchRecord', { trap: instance, note: 'a@b.com' });
    assert(setterCalls === 0, 'Test 23: sanitization never invokes an inherited prototype setter');
  } catch (err: any) {
    assert(false, 'Test 23: prototype setter safety', err.message);
  }

  // TEST 24: collision detection works in BOTH insertion orders, and for Sets
  try {
    const policy = new PiiRedactionPolicy();

    // Transformed key first, then a literal key equal to the placeholder.
    const forwardOrder = {
      m: new Map([
        ['alice@example.com', 'first'],
        ['[REDACTED_EMAIL]', 'second'],
      ]),
    };
    const forward = await policy.evaluateOutput(dummyCtx, 'fetchRecords', forwardOrder);
    assert(forward.decision === 'deny', 'Test 24a: transformed key colliding with a later literal placeholder key is detected');

    // Literal placeholder key first, then a key that redacts onto it.
    const reverseOrder = {
      m: new Map([
        ['[REDACTED_EMAIL]', 'first'],
        ['bob@example.com', 'second'],
      ]),
    };
    const reverse = await policy.evaluateOutput(dummyCtx, 'fetchRecords', reverseOrder);
    assert(reverse.decision === 'deny', 'Test 24b: literal placeholder key followed by a redacting key is also detected (reverse order)');

    // Two distinct Set members collapsing to one placeholder.
    const setCollision = { s: new Set(['alice@example.com', 'bob@example.com']) };
    const setResult = await policy.evaluateOutput(dummyCtx, 'fetchRecords', setCollision);
    assert(setResult.decision === 'deny', 'Test 24c: two Set members redacting to the same placeholder fails closed');
  } catch (err: any) {
    assert(false, 'Test 24: collision detection in both orders and for Sets', err.message);
  }

  // TEST 25: PII in a non-string (object) Map key is detected, not silently passed
  try {
    const policy = new PiiRedactionPolicy();
    const input = { records: new Map([[{ email: 'frank@example.com' }, 'value']]) };

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecords', input);
    assert(result.decision === 'deny', 'Test 25: PII inside an object-valued Map key fails closed instead of bypassing redaction');
  } catch (err: any) {
    assert(false, 'Test 25: PII in object Map keys', err.message);
  }

  // TEST 26: symbol-keyed PII inside an unrebuildable value is still detected
  try {
    const policy = new PiiRedactionPolicy();
    const tag = Symbol('contact');
    class Holder {}
    const instance = new Holder();
    Object.defineProperty(instance, tag, { value: 'grace@example.com', enumerable: true });

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecord', { holder: instance });
    assert(result.decision === 'deny', 'Test 26: symbol-keyed PII on a class instance is detected via Reflect.ownKeys');
  } catch (err: any) {
    assert(false, 'Test 26: symbol-keyed PII detection', err.message);
  }

  // TEST 17: PII hidden only under a forbidden (__proto__) key does not leak
  try {
    const policy = new PiiRedactionPolicy();
    // An own __proto__ key whose subtree contains PII; the forbidden key must be
    // dropped AND the result treated as sanitized (not allowed through as-is).
    const malicious = JSON.parse('{"__proto__": {"email": "leaked@example.com"}}');

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecord', malicious);
    assert(result.decision === 'sanitize', 'Test 17a: an object whose only content is under a forbidden key is sanitized, not allowed');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as Record<string, unknown>;
      assert(!Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), 'Test 17b: the forbidden key is dropped from the sanitized clone');
      assert(JSON.stringify(sanitized) === '{}', 'Test 17c: the PII-bearing subtree does not survive into the output');
    }
  } catch (err: any) {
    assert(false, 'Test 17: PII under a forbidden key', err.message);
  }

  // TEST 18: maxDepth is validated at construction
  try {
    let threw = false;
    try {
      new PiiRedactionPolicy({ maxDepth: -1 });
    } catch {
      threw = true;
    }
    assert(threw, 'Test 18a: a negative maxDepth is rejected at construction');

    let threwNaN = false;
    try {
      new PiiRedactionPolicy({ maxDepth: Number.NaN });
    } catch {
      threwNaN = true;
    }
    assert(threwNaN, 'Test 18b: a non-finite (NaN) maxDepth is rejected at construction');

    let threwFractional = false;
    try {
      new PiiRedactionPolicy({ maxDepth: 1.5 });
    } catch {
      threwFractional = true;
    }
    assert(threwFractional, 'Test 18c: a fractional (non-integer) maxDepth is rejected at construction');
  } catch (err: any) {
    assert(false, 'Test 18: maxDepth validation', err.message);
  }

  // TEST 19: PII in a Map key (not just the value) is redacted
  try {
    const policy = new PiiRedactionPolicy();
    const output = { records: new Map([['jane@example.com', 'active']]) };

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecords', output);
    assert(result.decision === 'sanitize', 'Test 19a: a PII-bearing Map key triggers sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as { records: Map<string, string> };
      const keys = [...sanitized.records.keys()];
      assert(!keys.some((k) => k.includes('jane@example.com')), 'Test 19b: the email in the Map key is redacted');
      assert(keys.some((k) => k.includes('[REDACTED_EMAIL]')), 'Test 19c: the redacted key carries the placeholder');
    }
  } catch (err: any) {
    assert(false, 'Test 19: PII in Map keys', err.message);
  }

  // TEST 20: object Map keys are preserved by reference so lookups still work
  try {
    const policy = new PiiRedactionPolicy();
    const objKey = { id: 1 };
    const input = { records: new Map<object, string>([[objKey, 'reach me at jane@example.com']]) };

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecords', input);
    assert(result.decision === 'sanitize', 'Test 20a: PII in the value still triggers sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as { records: Map<object, string> };
      // The original object key reference must still resolve — it was not cloned.
      assert(sanitized.records.get(objKey) !== undefined, 'Test 20b: an object Map key is preserved by reference (lookup still works)');
      assert(!String(sanitized.records.get(objKey)).includes('jane@example.com'), 'Test 20c: the value under the object key is still redacted');
    }
  } catch (err: any) {
    assert(false, 'Test 20: object Map key preservation', err.message);
  }

  // TEST 21: a Map-key redaction collision fails closed instead of silently dropping an entry
  try {
    const policy = new PiiRedactionPolicy();
    // Two distinct email keys both redact to [REDACTED_EMAIL] -> collision.
    const input = {
      records: new Map([
        ['alice@example.com', 'first'],
        ['bob@example.com', 'second'],
      ]),
    };

    const result = await policy.evaluateOutput(dummyCtx, 'fetchRecords', input);
    assert(result.decision === 'deny', 'Test 21a: a Map-key redaction collision fails closed (deny)');
    if (result.decision === 'deny') {
      assert(result.reason.toLowerCase().includes('collision'), 'Test 21b: the denial reason explains the key collision');
    }
  } catch (err: any) {
    assert(false, 'Test 21: Map key collision fail-closed', err.message);
  }

  // TEST 15: Circular references inside arrays are handled safely (not just plain objects)
  try {
    const policy = new PiiRedactionPolicy();
    const arr: any[] = ['contact jane@example.com'];
    arr.push(arr);

    const result = await policy.evaluateOutput(dummyCtx, 'getList', arr);
    assert(result.decision === 'sanitize', 'Test 15a: circular array is processed without stack overflow');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as any[];
      assert(sanitized[1] === sanitized, 'Test 15b: circular array reference points to the sanitized clone');
      assert(!sanitized[0].includes('jane@example.com'), 'Test 15c: array content is still sanitized');
    }
  } catch (err: any) {
    assert(false, 'Test 15: circular array safety', err.message);
  }

  // TEST 16: A custom pattern with a sticky ('y') flag still matches text that
  // doesn't start at offset 0, instead of being silently skipped.
  try {
    const policy = new PiiRedactionPolicy({
      customPatterns: [/EMP-\d{6}/y],
      redactEmail: false,
      redactPhone: false,
      redactCreditCard: false,
      redactSsn: false,
    });

    const output = 'Employee record for EMP-482910 filed today.';
    const result = await policy.evaluateOutput(dummyCtx, 'fetchEmployee', output);
    assert(result.decision === 'sanitize', 'Test 16a: sticky-flag custom pattern still matches text preceded by other content');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('EMP-482910'), 'Test 16b: the match is redacted despite the original sticky flag');
    }
  } catch (err: any) {
    assert(false, 'Test 16: sticky-flag custom pattern normalization', err.message);
  }

  console.log(`\n  📊 PiiRedactionPolicy Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('PiiRedactionPolicy Unit Tests Failed');
  }
}

if (require.main === module) {
  runPiiRedactionTests().catch(() => process.exit(1));
}
