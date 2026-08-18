import 'reflect-metadata';
import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';
import {
  McpCancelledError,
  McpClient,
  McpConnectionError,
  McpError,
  McpModule,
  McpProtocolError,
  McpService,
  McpTimeoutError,
  McpToolExecutionError,
  McpToolProvider,
  McpValidationError,
  mcpSchemaToToolParams,
  sanitizeStderr,
  validateGorillaPreConditions,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpToolSchema,
  type McpTransport,
} from '../src';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

/**
 * In-memory mock transport for deterministic testing without external binaries.
 */
class MockMcpTransport implements McpTransport {
  public isConnected = false;
  public sentMessages: JsonRpcMessage[] = [];
  public isClosed = false;
  public customResponder?: (message: JsonRpcMessage) => JsonRpcResponse | null;

  private messageHandlers: ((message: JsonRpcMessage) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    this.sentMessages.push(message);

    if (this.customResponder) {
      const customResp = this.customResponder(message);
      if (customResp) {
        setTimeout(() => this.receive(customResp), 1);
        return;
      }
    }

    // Auto-respond to standard protocol handshakes if mocked
    if ('method' in message) {
      if (message.method === 'initialize') {
        const resp: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: (message as JsonRpcRequest).id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
          },
        };
        setTimeout(() => this.receive(resp), 1);
      } else if (message.method === 'ping') {
        const resp: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: (message as JsonRpcRequest).id,
          result: {},
        };
        setTimeout(() => this.receive(resp), 1);
      }
    }
  }

  receive(message: JsonRpcMessage): void {
    for (const h of this.messageHandlers) {
      h(message);
    }
  }

  emitError(error: Error): void {
    for (const h of this.errorHandlers) {
      h(error);
    }
  }

  emitClose(): void {
    this.isConnected = false;
    for (const h of this.closeHandlers) {
      h();
    }
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.isConnected = false;
    this.isClosed = true;
    this.emitClose();
  }
}

async function runMcpTests(): Promise<void> {
  console.log('🧪 Running @nestjs-agentic/mcp Comprehensive Unit & Security Tests...\n');

  // =========================================================================
  // TEST 1: Schema Conversion (JSON Schema -> ToolParamSchema)
  // =========================================================================
  {
    console.log('  - Test 1: JSON Schema to ToolParamSchema Conversion');
    const inputSchema = {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term' },
        limit: { type: 'integer', description: 'Maximum results' },
        includeDetails: { type: 'boolean' },
        tags: { type: 'array' },
      },
      required: ['query'],
    };

    const params = mcpSchemaToToolParams(inputSchema);
    assert(params.length === 4, `Mapped 4 parameters (was ${params.length})`);
    const queryParam = params.find((p) => p.name === 'query')!;
    assert(queryParam.type === 'string', 'query is string');
    assert(queryParam.required === true, 'query is required');
    const limitParam = params.find((p) => p.name === 'limit')!;
    assert(limitParam.type === 'number', 'integer mapped to number');
    assert(limitParam.required === false, 'limit is optional');
    console.log('    ✓ JSON Schema to ToolParamSchema conversion verified');
  }

  // =========================================================================
  // TEST 2: Gorilla Deterministic Pre-Validation
  // =========================================================================
  {
    console.log('  - Test 2: Gorilla Deterministic Pre-conditions Validation');
    const schema = {
      type: 'object' as const,
      properties: {
        amount: { type: 'number' },
        recipient: { type: 'string' },
      },
      required: ['amount', 'recipient'],
    };

    // Valid call passes
    validateGorillaPreConditions('finance-server', 'transfer', schema, {
      amount: 100,
      recipient: 'alice',
    });

    // Missing required field throws McpValidationError
    let caughtMissing = false;
    try {
      validateGorillaPreConditions('finance-server', 'transfer', schema, {
        amount: 100,
      });
    } catch (err) {
      if (err instanceof McpValidationError) {
        caughtMissing = true;
        assert(err.paramName === 'recipient', 'Caught missing recipient param');
      }
    }
    assert(caughtMissing, 'Missing required argument caught by pre-validation');

    // Type mismatch throws McpValidationError
    let caughtTypeMismatch = false;
    try {
      validateGorillaPreConditions('finance-server', 'transfer', schema, {
        amount: 'NOT_A_NUMBER' as unknown as number,
        recipient: 'alice',
      });
    } catch (err) {
      if (err instanceof McpValidationError) {
        caughtTypeMismatch = true;
        assert(err.expectedType === 'number', 'Caught type mismatch');
      }
    }
    assert(caughtTypeMismatch, 'Type mismatch caught by pre-validation');
    console.log('    ✓ Gorilla deterministic pre-conditions validation verified');
  }

  // =========================================================================
  // TEST 3: McpClient Protocol Handshake & Version Negotiation
  // =========================================================================
  {
    console.log('  - Test 3: McpClient Protocol Handshake & Initialization');
    const transport = new MockMcpTransport();
    const client = new McpClient({
      serverName: 'test-server',
      transport,
    });

    await client.connect();
    assert(transport.sentMessages.length >= 2, 'Sent initialize and initialized messages');
    const initReq = transport.sentMessages[0] as JsonRpcRequest;
    assert(initReq.method === 'initialize', 'First message is initialize request');
    assert(
      (initReq.params as { protocolVersion: string }).protocolVersion === '2024-11-05',
      'Protocol version 2024-11-05 negotiated',
    );
    const initNotif = transport.sentMessages[1] as JsonRpcRequest;
    assert(initNotif.method === 'notifications/initialized', 'Sent notifications/initialized');
    console.log('    ✓ McpClient protocol handshake verified');
  }

  // =========================================================================
  // TEST 4: Tool Discovery (`tools/list`) and Response Caching
  // =========================================================================
  {
    console.log('  - Test 4: Tool Discovery & Caching');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'test-server', transport });

    const mockTools: McpToolSchema[] = [
      {
        name: 'calculate_tax',
        description: 'Computes tax',
        inputSchema: { type: 'object', properties: { income: { type: 'number' } } },
      },
    ];

    transport.customResponder = (msg) => {
      if ('method' in msg && msg.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: (msg as JsonRpcRequest).id,
          result: { tools: mockTools },
        };
      }
      return null;
    };

    const tools1 = await client.listTools();
    assert(tools1.length === 1, 'Discovered 1 tool');
    assert(tools1[0].name === 'calculate_tax', 'Tool name matches');

    // Second call should return cached without sending new request
    const sentCountBefore = transport.sentMessages.length;
    const tools2 = await client.listTools();
    assert(tools2.length === 1, 'Returned cached tools');
    assert(transport.sentMessages.length === sentCountBefore, 'No additional RPC request sent');
    console.log('    ✓ Tool discovery & caching verified');
  }

  // =========================================================================
  // TEST 5: Dynamic Tool Hot-Reloading (`notifications/tools/list_changed`)
  // =========================================================================
  {
    console.log('  - Test 5: Dynamic Tool Hot-Reloading on list_changed Notification');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'dynamic-server', transport });

    let toolsChangedCount = 0;
    client.onToolsChanged(() => {
      toolsChangedCount++;
    });

    await client.connect();

    // Server emits list_changed notification
    transport.receive({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });

    assert(toolsChangedCount === 1, 'Triggered toolsChanged listener');
    console.log('    ✓ Dynamic tool hot-reloading verified');
  }

  // =========================================================================
  // TEST 6: Tool Invocation & Output Unwrapping
  // =========================================================================
  {
    console.log('  - Test 6: Tool Invocation (`tools/call`)');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'calc-server', transport });

    transport.customResponder = (msg) => {
      if ('method' in msg && msg.method === 'tools/call') {
        const req = msg as JsonRpcRequest;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: 'Result: 42' }],
            isError: false,
          },
        };
      }
      return null;
    };

    const result = await client.callTool('add', { a: 20, b: 22 });
    assert(result.isError !== true, 'Execution succeeded');
    assert(result.content[0].type === 'text', 'Contains text block');
    assert((result.content[0] as { text: string }).text === 'Result: 42', 'Text content matches');
    console.log('    ✓ Tool invocation & output unwrapping verified');
  }

  // =========================================================================
  // TEST 7: Tool Execution Error Handling (`isError: true`)
  // =========================================================================
  {
    console.log('  - Test 7: Remote Tool Execution Error (`isError: true`)');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'error-server', transport });

    transport.customResponder = (msg) => {
      if ('method' in msg && msg.method === 'tools/call') {
        const req = msg as JsonRpcRequest;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: 'Database lock timeout' }],
            isError: true,
          },
        };
      }
      return null;
    };

    let caught = false;
    try {
      await client.callTool('queryDb', {});
    } catch (err) {
      if (err instanceof McpToolExecutionError) {
        caught = true;
        assert(err.errorDetail.includes('Database lock timeout'), 'Contains server error message');
      }
    }
    assert(caught, 'Thrown McpToolExecutionError on server isError');
    console.log('    ✓ Remote tool execution error handling verified');
  }

  // =========================================================================
  // TEST 8: Request Cancellation via AbortSignal & notifications/cancelled
  // =========================================================================
  {
    console.log('  - Test 8: Cancellation via AbortSignal & notifications/cancelled');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'cancel-server', transport });
    await client.connect();

    const abortController = new AbortController();

    // Trigger abort right after request dispatch while in-flight
    const promise = client.callTool('slow_computation', {}, abortController.signal);
    abortController.abort();

    let caughtAbort = false;
    try {
      await promise;
    } catch (err) {
      if (err instanceof McpCancelledError) {
        caughtAbort = true;
      }
    }
    assert(caughtAbort, 'Request cancelled on AbortSignal');
    const cancelNotif = transport.sentMessages.find(
      (m) => 'method' in m && m.method === 'notifications/cancelled',
    );
    assert(cancelNotif !== undefined, 'Emitted notifications/cancelled to server');
    console.log('    ✓ Cancellation via AbortSignal & cancellation notification verified');
  }

  // =========================================================================
  // TEST 9: Stderr Sanitization (OWASP LLM02 Secret Redaction)
  // =========================================================================
  {
    console.log('  - Test 9: Stderr Credential Sanitization (OWASP LLM02)');
    const rawStderr = 'Error in fetch: Bearer sk-ant-api03-secret123456 failed at https://api.internal/?token=supersecretkey';
    const sanitized = sanitizeStderr(rawStderr);
    assert(!sanitized.includes('sk-ant-api03-secret123456'), 'Bearer token redacted');
    assert(!sanitized.includes('supersecretkey'), 'URL token query param redacted');
    assert(sanitized.includes('[REDACTED]'), 'Redaction placeholder present');
    console.log('    ✓ Stderr credential sanitization verified');
  }

  // =========================================================================
  // TEST 10: McpToolProvider Policy Integration
  // =========================================================================
  {
    console.log('  - Test 10: McpToolProvider Governance Policy Integration');
    const transport = new MockMcpTransport();
    const client = new McpClient({ serverName: 'gov-server', transport });

    transport.customResponder = (msg) => {
      if ('method' in msg && msg.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: (msg as JsonRpcRequest).id,
          result: {
            tools: [
              {
                name: 'deleteDatabase',
                description: 'Deletes database',
                inputSchema: { type: 'object' },
              },
            ],
          },
        };
      }
      return null;
    };

    const mockDenyPolicy: ToolPolicy = {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'deny', reason: 'High-risk tool denied for standard role' };
      },
    };

    const provider = new McpToolProvider({
      client,
      policies: [mockDenyPolicy],
    });

    const context: AgentContext = {
      sessionId: 'sess_mcp_policy',
      traceId: 'trace_mcp_policy',
      security: { tenantId: 'tenant_test' },
    };

    const tools = await provider.buildTools(context);
    assert(tools.length === 1, 'Built 1 resolved tool');

    const result = await tools[0].execute({ args: {} });
    assert(result.success === false, 'Execution denied by policy');
    if (result.success === false) {
      assert(result.status === 'denied', 'Status is denied');
      assert(result.reason.includes('High-risk tool denied'), 'Reason populated');
    }
    console.log('    ✓ McpToolProvider governance policy integration verified');
  }

  // =========================================================================
  // TEST 11: McpService & McpModule Registration
  // =========================================================================
  {
    console.log('  - Test 11: McpService & McpModule Registration');
    const customTransport = new MockMcpTransport();

    const service = new McpService({
      servers: [
        {
          name: 'mock-server',
          transport: { type: 'custom', transport: customTransport },
        },
      ],
    });

    await service.onModuleInit();
    const client = service.getClient('mock-server');
    assert(client !== null, 'Client retrieved from McpService');
    assert(client.serverName === 'mock-server', 'Server name matches');

    await service.onModuleDestroy();
    assert(customTransport.isClosed, 'Transport cleanly closed on module destroy');
    console.log('    ✓ McpService & McpModule lifecycle verified');
  }

  console.log('🎉 All MCP Unit & Security Tests Passed!\n');
}

if (require.main === module) {
  runMcpTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
