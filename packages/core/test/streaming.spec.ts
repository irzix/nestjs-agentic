import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentRunner,
  AgenticModuleOptions,
  LocalToolProvider,
  MockRuntimeAdapter,
  ToolDiscoveryService,
  ToolSet,
  Tool,
} from '../src';
import type { AgentProvider, AgentConfig, AgentStreamEvent } from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';

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

    assert(events.length >= 3, 'Test 1a: Stream emitted multiple structured events');
    assert(events[0].type === 'tool_start', 'Test 1b: First event is "tool_start"');
    assert(events[1].type === 'tool_result', 'Test 1c: Second event is "tool_result"');
    assert(events[events.length - 1].type === 'complete', 'Test 1d: Final event is "complete"');
  } catch (err: any) {
    assert(false, 'Test 1: AgentRunner runStream Event Emitting', err.message);
  }

  console.log(`\n  📊 Streaming Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Streaming Unit Tests Failed');
  }
}

if (require.main === module) {
  runStreamingTests().catch(() => process.exit(1));
}
