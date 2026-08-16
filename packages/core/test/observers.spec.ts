import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgentObserver,
  AgentResult,
  AgentRunner,
  AgentStreamEvent,
  AgenticModule,
  InMemoryAgentObserver,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  OpenTelemetryGenAiObserver,
  Param,
  StructuredLogObserver,
  Tool,
  ToolSet,
} from '../src';
import type { AgentConfig, AgentProvider } from '../src';

class MockChatModelAdapter implements ModelAdapter {
  rounds = 0;

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.rounds++;
    if (this.rounds === 1) {
      return {
        content: 'I will calculate that.',
        toolCalls: [
          {
            id: 'call_calc_1',
            name: 'calculate',
            args: { expression: '2 + 2' },
          },
        ],
        usage: {
          inputTokens: 15,
          outputTokens: 10,
          totalTokens: 25,
        },
      };
    }

    return {
      content: 'The answer is 4.',
      usage: {
        inputTokens: 25,
        outputTokens: 8,
        totalTokens: 33,
      },
    };
  }
}

@ToolSet({ name: 'math' })
class MathToolSet {
  @Tool({
    name: 'calculate',
    description: 'Calculate math expressions',
  })
  calculate(@Param('expression') expression: string) {
    return { result: 4 };
  }
}

@Agent({
  name: 'MathAgent',
  description: 'Agent that solves math problems',
})
class MathAgent implements AgentProvider {
  constructor(private readonly tools: MathToolSet) {}

  define(): AgentConfig {
    return {
      instructions: 'Solve math questions',
      tools: [this.tools],
    };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

export async function runObserversTests() {
  console.log('🧪 Starting Runtime Observers & OpenTelemetry Tracing Test Suite...');

  // Test 1: Full Lifecycle Hook Sequence
  {
    console.log('  - Test 1: Full lifecycle hook order in AgentRunner execution');
    const inMemoryObserver = new InMemoryAgentObserver();
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [inMemoryObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    const result = await runner.run('MathAgent', {
      sessionId: 'session_obs_1',
      message: 'What is 2+2?',
    });

    assert(result.output === 'The answer is 4.', 'Output should match final round');

    // Verify hook calls
    assert(inMemoryObserver.startEvents.length === 1, `Should emit 1 onAgentStart, got ${inMemoryObserver.startEvents.length}`);
    assert(inMemoryObserver.startEvents[0].agentName === 'MathAgent', 'Agent name should match');
    assert(inMemoryObserver.startEvents[0].sessionId === 'session_obs_1', 'SessionId should match');

    assert(inMemoryObserver.modelRequestEvents.length === 2, 'Should emit 2 onModelRequest');
    assert(inMemoryObserver.modelResponseEvents.length === 2, 'Should emit 2 onModelResponse');

    assert(inMemoryObserver.toolCallEvents.length === 1, 'Should emit 1 onToolCall');
    assert(inMemoryObserver.toolCallEvents[0].toolName === 'calculate', 'Tool name should match');
    assert(
      (inMemoryObserver.toolCallEvents[0].args as Record<string, unknown>).expression === '2 + 2',
      'Tool args should match',
    );

    assert(inMemoryObserver.toolResultEvents.length === 1, 'Should emit 1 onToolResult');
    const toolResult = inMemoryObserver.toolResultEvents[0].result as { data?: { result?: number } };
    assert(
      toolResult?.data?.result === 4,
      'Tool result should match',
    );
    assert(
      inMemoryObserver.toolResultEvents[0].durationMs >= 0,
      'Tool duration should be tracked',
    );

    assert(inMemoryObserver.endEvents.length === 1, 'Should emit 1 onAgentEnd');
    assert(inMemoryObserver.endEvents[0].result.output === 'The answer is 4.', 'Result output should match');
    assert(inMemoryObserver.endEvents[0].durationMs >= 0, 'Duration should be tracked');

    // Verify ordering
    const eventTypes = inMemoryObserver.allEvents.map((e) => e.type);
    assert(
      JSON.stringify(eventTypes) ===
        JSON.stringify([
          'agent_start',
          'model_request',
          'model_response',
          'tool_call',
          'tool_result',
          'model_request',
          'model_response',
          'agent_end',
        ]),
      `Event order incorrect: ${JSON.stringify(eventTypes)}`,
    );
    console.log('    ✓ Correct lifecycle event sequencing verified');
  }

  // Test 2: Error Isolation (Failing Observer Must Not Fail Agent Turn)
  {
    console.log('  - Test 2: Error isolation (faulty observer does not crash agent turn)');
    const faultyObserver: AgentObserver = {
      onAgentStart() {
        throw new Error('Exploding start observer');
      },
      onModelRequest() {
        throw new Error('Exploding model request observer');
      },
      onModelResponse() {
        throw new Error('Exploding model response observer');
      },
      onToolCall() {
        throw new Error('Exploding tool call observer');
      },
      onToolResult() {
        throw new Error('Exploding tool result observer');
      },
      onAgentEnd() {
        throw new Error('Exploding end observer');
      },
      onError() {
        throw new Error('Exploding error observer');
      },
    };

    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [faultyObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    const result = await runner.run('MathAgent', {
      sessionId: 'session_faulty_obs',
      message: 'Compute 2+2',
    });

    assert(result.output === 'The answer is 4.', 'Output should match');
    console.log('    ✓ Complete observer error isolation verified');
  }

  // Test 3: OpenTelemetry GenAI Semantic Conventions
  {
    console.log('  - Test 3: OpenTelemetryGenAiObserver standard GenAI attributes');
    const otelObserver = new OpenTelemetryGenAiObserver({ system: 'openai' });
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [otelObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    await runner.run('MathAgent', {
      sessionId: 'session_otel_1',
      message: 'Calculate something',
      context: {
        userId: 'user_123',
        tenantId: 'tenant_abc',
        parentTraceId: 'trace_parent_001',
        rootTraceId: 'trace_root_001',
      },
    });

    assert(otelObserver.records.length >= 6, `Expected at least 6 records, got ${otelObserver.records.length}`);

    // Check Start record
    const startRecord = otelObserver.records.find((r) => r.name.includes('start'))!;
    assert(startRecord !== undefined, 'Should have start record');
    assert(startRecord.attributes['gen_ai.operation.name'] === 'agent', 'operation name should be agent');
    assert(startRecord.attributes['gen_ai.agent.name'] === 'MathAgent', 'agent name should match');
    assert(startRecord.attributes['gen_ai.agent.session_id'] === 'session_otel_1', 'session id should match');
    assert(startRecord.attributes['gen_ai.user.id'] === 'user_123', 'user id should match');
    assert(startRecord.attributes['gen_ai.tenant.id'] === 'tenant_abc', 'tenant id should match');
    assert(startRecord.attributes['gen_ai.parent_trace.id'] === 'trace_parent_001', 'parent trace id should match');
    assert(startRecord.attributes['gen_ai.root_trace.id'] === 'trace_root_001', 'root trace id should match');

    // Check Model response record
    const modelRecord = otelObserver.records.find((r) => r.name.includes('model response'))!;
    assert(modelRecord !== undefined, 'Should have model response record');
    assert(modelRecord.attributes['gen_ai.operation.name'] === 'chat', 'model operation should be chat');
    assert(modelRecord.attributes['gen_ai.response.model'] === 'gpt-4o', 'response model should match');
    assert(modelRecord.attributes['gen_ai.usage.prompt_tokens'] === 15, 'prompt tokens should match');
    assert(modelRecord.attributes['gen_ai.usage.completion_tokens'] === 10, 'completion tokens should match');
    assert(modelRecord.attributes['gen_ai.usage.total_tokens'] === 25, 'total tokens should match');

    // Check Tool result record
    const toolRecord = otelObserver.records.find((r) => r.name.includes('tool result'))!;
    assert(toolRecord !== undefined, 'Should have tool result record');
    assert(toolRecord.attributes['gen_ai.operation.name'] === 'execute_tool', 'tool operation should be execute_tool');
    assert(toolRecord.attributes['gen_ai.tool.name'] === 'calculate', 'tool name should match calculate');
    assert(toolRecord.attributes['gen_ai.tool.call_id'] === 'call_calc_1', 'call id should match');

    // Check End record
    const endRecord = otelObserver.records.find((r) => r.name.includes('end'))!;
    assert(endRecord !== undefined, 'Should have end record');
    assert(endRecord.attributes['gen_ai.agent.name'] === 'MathAgent', 'agent name should match');

    console.log('    ✓ OpenTelemetry GenAI semantic attributes verified');
  }

  // Test 4: Streaming Lifecycle Hooks
  {
    console.log('  - Test 4: Streaming lifecycle hooks in runStream()');
    const inMemoryObserver = new InMemoryAgentObserver();
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [inMemoryObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    const events: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('MathAgent', {
      sessionId: 'session_stream_obs',
      message: 'Solve stream',
    })) {
      events.push(event);
    }

    assert(events.length > 0, 'Stream should emit events');
    assert(inMemoryObserver.startEvents.length === 1, 'Stream should fire onAgentStart');
    assert(inMemoryObserver.endEvents.length === 1, 'Stream should fire onAgentEnd');
    assert(inMemoryObserver.toolCallEvents.length === 1, 'Stream should fire onToolCall');
    assert(inMemoryObserver.toolResultEvents.length === 1, 'Stream should fire onToolResult');
    console.log('    ✓ Streaming lifecycle hooks verified');
  }

  // Test 5: Error Dispatched to Observer
  {
    console.log('  - Test 5: onError lifecycle hook when turn throws');
    const inMemoryObserver = new InMemoryAgentObserver();
    const failingAdapter: ModelAdapter = {
      async generate() {
        throw new Error('API Rate Limit Exceeded');
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter: failingAdapter,
          observers: [inMemoryObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    let thrown = false;
    try {
      await runner.run('MathAgent', {
        sessionId: 'session_err_obs',
        message: 'Fail please',
      });
    } catch {
      thrown = true;
    }

    assert(thrown, 'AgentRunner should propagate error');
    assert(inMemoryObserver.startEvents.length === 1, 'Should emit onAgentStart');
    assert(inMemoryObserver.errorEvents.length === 1, 'Should emit onError');
    assert(
      inMemoryObserver.errorEvents[0].error.message === 'API Rate Limit Exceeded',
      'Error message should match',
    );
    console.log('    ✓ onError lifecycle event verified');
  }

  // Test 6: Nested Trace Propagation (Parent and Root Tracing)
  {
    console.log('  - Test 6: Nested trace propagation across agent context and events');
    const inMemoryObserver = new InMemoryAgentObserver();
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [inMemoryObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    await runner.run('MathAgent', {
      sessionId: 'session_nested_traces',
      message: 'Calculate',
      context: {
        traceId: 'sub_turn_trace_789',
        parentTraceId: 'parent_workflow_456',
        rootTraceId: 'root_session_123',
      },
    });

    assert(inMemoryObserver.startEvents[0].traceId === 'sub_turn_trace_789', 'traceId should match');
    assert(inMemoryObserver.startEvents[0].parentTraceId === 'parent_workflow_456', 'parentTraceId should match');
    assert(inMemoryObserver.startEvents[0].rootTraceId === 'root_session_123', 'rootTraceId should match');

    assert(inMemoryObserver.modelRequestEvents[0].parentTraceId === 'parent_workflow_456', 'modelRequest parentTraceId preserved');
    assert(inMemoryObserver.toolCallEvents[0].parentTraceId === 'parent_workflow_456', 'toolCall parentTraceId preserved');
    assert(inMemoryObserver.endEvents[0].parentTraceId === 'parent_workflow_456', 'endEvent parentTraceId preserved');
    console.log('    ✓ Nested trace hierarchy propagation verified');
  }

  // Test 7: Sampling Rate Controls
  {
    console.log('  - Test 7: Sampling strategy controls observer event dispatch');
    const inMemoryObserver = new InMemoryAgentObserver();
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [inMemoryObserver],
          samplingRate: 0.0, // 0% sampling - drops all events
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    await runner.run('MathAgent', {
      sessionId: 'session_sampled_out',
      message: 'Calculate something',
    });

    assert(inMemoryObserver.allEvents.length === 0, 'Zero events should be captured when samplingRate=0.0');
    console.log('    ✓ Sampling rate filter verified');
  }

  // Test 8: Memory Bounds and FIFO Trimming in InMemoryAgentObserver
  {
    console.log('  - Test 8: InMemoryAgentObserver FIFO bounds memory trimming');
    const boundedObserver = new InMemoryAgentObserver({ maxEvents: 2 });
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [boundedObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    await runner.run('MathAgent', {
      sessionId: 'session_memory_bounds',
      message: 'Calculate',
    });

    assert(boundedObserver.allEvents.length <= 2, `Expected allEvents <= 2, got ${boundedObserver.allEvents.length}`);
    assert(boundedObserver.modelRequestEvents.length <= 2, 'modelRequestEvents bounded');
    console.log('    ✓ Bounded memory buffer eviction verified');
  }

  // Test 9: OpenTelemetry Exporter Error Isolation
  {
    console.log('  - Test 9: OpenTelemetryGenAiObserver exporter failure isolation');
    const faultyExporterObserver = new OpenTelemetryGenAiObserver({
      exporter() {
        throw new Error('Collector connection timed out');
      },
    });
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [faultyExporterObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    const result = await runner.run('MathAgent', {
      sessionId: 'session_otel_faulty',
      message: 'Test OTel error',
    });

    assert(result.output === 'The answer is 4.', 'Execution succeeded despite exporter failure');
    console.log('    ✓ OpenTelemetry exporter failure isolation verified');
  }

  // Test 10: StructuredLogObserver JSON logging
  {
    console.log('  - Test 10: StructuredLogObserver outputs structured JSON entries');
    const logs: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const customLogger = {
      log: (msg: string, ctx?: Record<string, unknown>) => logs.push({ msg, ctx }),
      error: (msg: string, _trace?: string, ctx?: Record<string, unknown>) => logs.push({ msg, ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => logs.push({ msg, ctx }),
      debug: (msg: string, ctx?: Record<string, unknown>) => logs.push({ msg, ctx }),
    };

    const structuredObserver = new StructuredLogObserver({ logger: customLogger });
    const modelAdapter = new MockChatModelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'openai', model: 'gpt-4o' },
          modelAdapter,
          observers: [structuredObserver],
        }),
        AgenticModule.forFeature({
          agents: [MathAgent],
          toolSets: [MathToolSet],
        }),
      ],
    }).compile();

    const runner = moduleRef.get(AgentRunner);
    await runner.run('MathAgent', {
      sessionId: 'session_structured_log',
      message: 'Run structured',
    });

    assert(logs.some((l) => l.msg === 'agent_started'), 'Should log agent_started');
    assert(logs.some((l) => l.msg === 'tool_call_initiated'), 'Should log tool_call_initiated');
    assert(logs.some((l) => l.msg === 'tool_result_received'), 'Should log tool_result_received');
    assert(logs.some((l) => l.msg === 'agent_completed'), 'Should log agent_completed');
    console.log('    ✓ StructuredLogObserver logging verified');
  }

  console.log('🎉 All Runtime Observers & OpenTelemetry Tests Passed!\n');
}
