import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentRunner,
  AgenticModuleOptions,
  InMemoryApprovalStore,
  LocalToolProvider,
  MockRuntimeAdapter,
  ToolDiscoveryService,
  ToolSet,
  Tool,
} from '../src';
import type { AgentProvider, AgentConfig, AgentStreamEvent } from '../src';

@ToolSet({ name: 'mockToolset' })
class MockToolClass {
  @Tool({ description: 'Mock tool for streaming' })
  async mockTool() {
    return { status: 'success', data: 'streamed_tool_response' };
  }
}

@Agent({ name: 'stream-agent', description: 'Stream Testing Agent' })
class TestStreamAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: 'Mock streaming agent instructions',
      tools: [MockToolClass],
    };
  }
}

class MockModuleRef {
  get(token: any): any {
    if (token === MockToolClass) return new MockToolClass();
    return undefined;
  }
}

export async function runStreamingTests() {
  console.log('📡 Running AgentRunner Streaming Event Unit Tests...\n');

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

  try {
    const discovery = new ToolDiscoveryService();
    const store = new InMemoryApprovalStore();
    const moduleRef = new MockModuleRef() as unknown as ModuleRef;

    const localToolProvider = new LocalToolProvider([], store, discovery, moduleRef);
    const mockRuntime = new MockRuntimeAdapter();
    const options: AgenticModuleOptions = {
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    };

    const agentInstance = new TestStreamAgent();
    const runner = new AgentRunner(
      [agentInstance],
      mockRuntime,
      options,
      localToolProvider,
      moduleRef,
    );

    mockRuntime
      .whenAsked('Test stream message')
      .thenCallTool('mockTool', { key: 'val' });

    const events: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('stream-agent', {
      sessionId: 'sess_stream_1',
      message: 'Test stream message',
    })) {
      events.push(event);
    }

    const ev0 = events[0];
    const ev1 = events[1];
    const ev2 = events[2];
    const ev3 = events[3];

    assert(events.length >= 6, 'Test 1a: Stream emitted complete ReAct lifecycle event sequence');
    assert(ev0.type === 'tool_start', 'Test 1b: First event is "tool_start" for backwards compatibility');
    assert(ev1.type === 'action_call', 'Test 1c: Second event is ReAct "action_call"');
    assert(ev1.type === 'action_call' && ev1.toolName === 'mockTool', 'Test 1d: "action_call" carries toolName');
    assert(ev2.type === 'tool_result', 'Test 1e: Third event is "tool_result"');
    assert(ev3.type === 'action_observation', 'Test 1f: Fourth event is ReAct "action_observation"');

    const finalAnswerIdx = events.findIndex((e) => e.type === 'final_answer');
    const completeIdx = events.findIndex((e) => e.type === 'complete');
    assert(finalAnswerIdx !== -1, 'Test 1g: "final_answer" event is emitted');
    const finalAnswerEv = events[finalAnswerIdx];
    assert(completeIdx !== -1, 'Test 1h: "complete" event is emitted');
    assert(finalAnswerIdx < completeIdx, 'Test 1i: "final_answer" precedes "complete"');
    assert(
      finalAnswerEv.type === 'final_answer' && finalAnswerEv.sessionId === 'sess_stream_1',
      'Test 1j: "final_answer" includes sessionId',
    );
    assert(events[events.length - 1].type === 'complete', 'Test 1k: Final event is "complete"');
    assert(ev0.type === 'tool_start' && Boolean(ev0.id), 'Test 1l: "tool_start" carries correlation id');
    assert(
      ev0.type === 'tool_start' && ev1.type === 'action_call' && ev0.id === ev1.id,
      'Test 1m: "tool_start" and "action_call" share identical correlation id for deduplication',
    );
    assert(
      ev2.type === 'tool_result' && ev3.type === 'action_observation' && ev2.id === ev3.id,
      'Test 1n: "tool_result" and "action_observation" share identical correlation id for deduplication',
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert(false, 'Test 1: AgentRunner runStream Event Emitting', message);
  }

  console.log(`\n  📊 Streaming Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Streaming Unit Tests Failed');
  }
}

if (require.main === module) {
  runStreamingTests().catch(() => process.exit(1));
}
