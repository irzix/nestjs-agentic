import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgentObserver,
  AgentResult,
  AgentRunner,
  AgenticModule,
  InMemoryAgentObserver,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  OpenTelemetryGenAiObserver,
  Param,
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
      (inMemoryObserver.toolCallEvents[0].args as any).expression === '2 + 2',
      'Tool args should match',
    );

    assert(inMemoryObserver.toolResultEvents.length === 1, 'Should emit 1 onToolResult');
    assert(
      (inMemoryObserver.toolResultEvents[0].result as any).data?.result === 4,
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

    // Check Model response record
    const modelRecord = otelObserver.records.find((r) => r.name.includes('model response'))!;
    assert(modelRecord !== undefined, 'Should have model response record');
    assert(modelRecord.attributes['gen_ai.operation.name'] === 'chat', 'model operation should be chat');
    assert(modelRecord.attributes['gen_ai.request.model'] === undefined, 'response should not have request model duplicate');
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
    const events: any[] = [];
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

  console.log('🎉 All Runtime Observers & OpenTelemetry Tests Passed!\n');
}
