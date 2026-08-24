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

  console.log(`\n  📊 PiiRedactionPolicy Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('PiiRedactionPolicy Unit Tests Failed');
  }
}

if (require.main === module) {
  runPiiRedactionTests().catch(() => process.exit(1));
}
