import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  InMemoryApprovalStore,
  LocalToolProvider,
  ToolDiscoveryService,
  ModelCascadeAdapter,
  ModelCascadeRouter,
  CascadeExhaustedError,
  CascadeConfigurationError,
  extractVerbalizedConfidence,
  extractHeuristicConfidence,
} from '../src';
import type {
  AgentConfig,
  AgentProvider,
  AgentResult,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  CascadeOptions,
  CascadeEscalationEvent,
} from '../src';

@Agent({
  name: 'frugal-support-agent',
  description: 'Customer support with FrugalGPT cost cascading',
  cascade: {
    fastModel: { model: 'gpt-4o-mini' },
    reasoningModel: { model: 'gpt-4o' },
    confidenceThreshold: 0.85,
  },
})
class FrugalSupportAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: 'You are a helpful customer support agent.',
      tools: [],
    };
  }
}

class MockModuleRef {
  get(_token: unknown): unknown {
    return undefined;
  }
}

export async function runModelCascadeTests() {
  console.log('⚡ Running Step 18: FrugalGPT Model Cascading & Routing Tests...\n');

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

  // 1. Confidence Extractors: Verbalized
  try {
    const dec = extractVerbalizedConfidence('The answer is Paris. [Confidence: 0.92]');
    assert(dec === 0.92, 'Extract verbalized decimal confidence [Confidence: 0.92]');

    const pct = extractVerbalizedConfidence('Status OK. Confidence: 85%');
    assert(pct === 0.85, 'Extract verbalized percentage confidence 85%');

    const ratio = extractVerbalizedConfidence('Verification passed. Score: 9/10');
    assert(ratio === 0.9, 'Extract verbalized ratio score 9/10');

    const none = extractVerbalizedConfidence('Standard text without metrics.');
    assert(none === null, 'Return null when no verbalized score is present');
  } catch (err: unknown) {
    assert(false, 'Verbalized confidence extractors', String(err));
  }

  // 2. Confidence Extractors: Heuristic
  try {
    const toolCallResp: ModelResponse = {
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'search_db', args: { q: 'status' } }],
    };
    const toolScore = extractHeuristicConfidence(toolCallResp.content, toolCallResp);
    assert(toolScore >= 0.85, 'Heuristic extractor rewards tool calls with high confidence');

    const hedgeResp: ModelResponse = {
      content: 'I am not sure, but it is unclear what happened. Might be wrong.',
    };
    const hedgeScore = extractHeuristicConfidence(hedgeResp.content, hedgeResp);
    assert(hedgeScore < 0.70, 'Heuristic extractor penalizes uncertainty hedging');
  } catch (err: unknown) {
    assert(false, 'Heuristic confidence extractors', String(err));
  }

  // 3. ModelCascadeAdapter: Early exit at Tier 1
  try {
    let callCount = 0;
    const mockAdapter: ModelAdapter = {
      generate: async (req: ModelRequest) => {
        callCount++;
        return {
          content: 'Here is the precise and confident answer. [Confidence: 0.95]',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        };
      },
    };

    const cascade = new ModelCascadeAdapter(mockAdapter, {
      fastModel: { model: 'gpt-4o-mini' },
      reasoningModel: { model: 'gpt-4o' },
      confidenceThreshold: 0.85,
    });

    const result = await cascade.generate({
      model: { model: 'default' },
      messages: [{ role: 'user', content: 'Simple query' }],
      tools: [],
      metadata: { sessionId: 's1', traceId: 't1', executionId: 'e1', iteration: 0 },
    });

    assert(callCount === 1, 'Early exit invokes adapter exactly once');
    assert(result.cascadeMetadata?.tiersAttempted === 1, 'Tiers attempted is 1');
    assert(result.cascadeMetadata?.finalModel === 'gpt-4o-mini', 'Final model is fastModel');
    assert(result.cascadeMetadata?.escalated === false, 'Escalated is false');
    assert(result.usage?.totalTokens === 30, 'Token usage matches single tier');
  } catch (err: unknown) {
    assert(false, 'ModelCascadeAdapter early exit', String(err));
  }

  // 4. ModelCascadeAdapter: Escalation to Tier 2 on uncertainty
  try {
    const escalations: CascadeEscalationEvent[] = [];
    const calls: string[] = [];

    const mockAdapter: ModelAdapter = {
      generate: async (req: ModelRequest) => {
        calls.push(req.model.model);
        if (req.model.model === 'gpt-4o-mini') {
          return {
            content: 'I am unable to determine the status of this ticket. It is unclear.',
            usage: { inputTokens: 15, outputTokens: 20, totalTokens: 35 },
          };
        }
        return {
          content: 'Here is the deep reasoning result. [Confidence: 0.98]',
          usage: { inputTokens: 20, outputTokens: 80, totalTokens: 100 },
        };
      },
    };

    const cascade = new ModelCascadeAdapter(mockAdapter, {
      fastModel: { model: 'gpt-4o-mini' },
      reasoningModel: { model: 'gpt-4o' },
      confidenceThreshold: 0.85,
      onEscalate: (ev) => {
        escalations.push(ev);
      },
    });

    const result = await cascade.generate({
      model: { model: 'default' },
      messages: [{ role: 'user', content: 'Complex query' }],
      tools: [],
      metadata: { sessionId: 's1', traceId: 't1', executionId: 'e1', iteration: 0 },
    });

    assert(calls.length === 2, 'Escalation calls both fast and reasoning models');
    assert(calls[0] === 'gpt-4o-mini' && calls[1] === 'gpt-4o', 'Correct model execution order');
    assert(result.cascadeMetadata?.tiersAttempted === 2, 'Tiers attempted is 2');
    assert(result.cascadeMetadata?.finalModel === 'gpt-4o', 'Final model is reasoningModel');
    assert(result.cascadeMetadata?.escalated === true, 'Escalated flag is true');
    assert(result.usage?.totalTokens === 135, 'Cumulative token usage correctly summed');
    assert(escalations.length === 1, 'onEscalate callback invoked once');
    assert(escalations[0].fromModel === 'gpt-4o-mini' && escalations[0].toModel === 'gpt-4o', 'Escalation event carries correct models');
  } catch (err: unknown) {
    assert(false, 'ModelCascadeAdapter escalation', String(err));
  }

  // 5. ModelCascadeAdapter: Error resilience & escalation
  try {
    const mockAdapter: ModelAdapter = {
      generate: async (req: ModelRequest) => {
        if (req.model.model === 'gpt-4o-mini') {
          throw new Error('503 Service Unavailable');
        }
        return {
          content: 'Frontier model response. [Confidence: 0.90]',
          usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        };
      },
    };

    const cascade = new ModelCascadeAdapter(mockAdapter, {
      fastModel: { model: 'gpt-4o-mini' },
      reasoningModel: { model: 'gpt-4o' },
    });

    const result = await cascade.generate({
      model: { model: 'default' },
      messages: [{ role: 'user', content: 'Resilience test' }],
      tools: [],
      metadata: { sessionId: 's1', traceId: 't1', executionId: 'e1', iteration: 0 },
    });

    assert(result.cascadeMetadata?.tiersAttempted === 2, 'Error in fast tier escalates to next tier');
    assert(result.cascadeMetadata?.finalModel === 'gpt-4o', 'Final model resolved successfully');
  } catch (err: unknown) {
    assert(false, 'ModelCascadeAdapter error resilience', String(err));
  }

  // 6. N-tier cascade (M1 -> M2 -> M3)
  try {
    const mockAdapter: ModelAdapter = {
      generate: async (req: ModelRequest) => {
        if (req.model.model === 'm1') {
          return { content: 'I am not sure.', usage: { totalTokens: 10 } };
        }
        if (req.model.model === 'm2') {
          return { content: 'It is difficult to say.', usage: { totalTokens: 20 } };
        }
        return { content: 'Definitive answer. [Confidence: 0.99]', usage: { totalTokens: 50 } };
      },
    };

    const cascade = new ModelCascadeAdapter(mockAdapter, {
      tiers: [
        { model: { model: 'm1' }, confidenceThreshold: 0.85 },
        { model: { model: 'm2' }, confidenceThreshold: 0.90 },
        { model: { model: 'm3' } },
      ],
    });

    const result = await cascade.generate({
      model: { model: 'default' },
      messages: [{ role: 'user', content: 'N-tier query' }],
      tools: [],
      metadata: { sessionId: 's1', traceId: 't1', executionId: 'e1', iteration: 0 },
    });

    assert(result.cascadeMetadata?.tiersAttempted === 3, 'N-tier cascade traversed all 3 tiers');
    assert(result.cascadeMetadata?.finalModel === 'm3', 'N-tier resolved at final tier');
    assert(result.usage?.totalTokens === 80, 'Cumulative usage across all 3 tiers (10+20+50)');
  } catch (err: unknown) {
    assert(false, 'N-tier cascade', String(err));
  }

  // 7. CascadeExhaustedError when fallbackStrategy: 'throw'
  try {
    const mockAdapter: ModelAdapter = {
      generate: async () => ({
        content: 'I do not have access.',
      }),
    };

    const cascade = new ModelCascadeAdapter(mockAdapter, {
      tiers: [
        { model: { model: 'm1' }, confidenceThreshold: 0.95 },
        { model: { model: 'm2' }, confidenceThreshold: 0.95 },
      ],
      fallbackStrategy: 'throw',
    });

    let threwExhausted = false;
    try {
      await cascade.generate({
        model: { model: 'default' },
        messages: [{ role: 'user', content: 'Exhaustion test' }],
        tools: [],
        metadata: { sessionId: 's1', traceId: 't1', executionId: 'e1', iteration: 0 },
      });
    } catch (e: unknown) {
      threwExhausted = e instanceof CascadeExhaustedError;
    }
    assert(threwExhausted, 'Throws CascadeExhaustedError on unreached threshold with throw strategy');
  } catch (err: unknown) {
    assert(false, 'CascadeExhaustedError test', String(err));
  }

  // 8. CascadeConfigurationError validation
  try {
    let threwConfig = false;
    try {
      new ModelCascadeAdapter({ generate: async () => ({ content: '' }) }, { tiers: [] } as unknown as CascadeOptions);
    } catch (e: unknown) {
      threwConfig = e instanceof CascadeConfigurationError;
    }
    assert(threwConfig, 'Throws CascadeConfigurationError on empty tiers');
  } catch (err: unknown) {
    assert(false, 'CascadeConfigurationError test', String(err));
  }

  // 9. ModelCascadeRouter complexity estimation
  try {
    assert(ModelCascadeRouter.estimateComplexity('What is 2+2?') === 'simple', 'Simple query complexity');
    assert(
      ModelCascadeRouter.estimateComplexity('Please mathematically prove the consistency of Peano arithmetic step by step.') ===
        'complex',
      'Complex mathematical query complexity',
    );
  } catch (err: unknown) {
    assert(false, 'ModelCascadeRouter complexity estimation', String(err));
  }

  // 10. End-to-end AgentRunner with @Agent({ cascade: ... })
  try {
    const discovery = new ToolDiscoveryService();
    const store = new InMemoryApprovalStore();
    const moduleRef = new MockModuleRef() as unknown as ModuleRef;
    const localToolProvider = new LocalToolProvider([], store, discovery, moduleRef);
    const agentInstance = new FrugalSupportAgent();

    const mockAdapter: ModelAdapter = {
      generate: async (req: ModelRequest) => {
        if (req.model.model === 'gpt-4o-mini') {
          return {
            content: 'Your order #12345 has shipped! [Confidence: 0.95]',
            usage: { totalTokens: 40 },
          };
        }
        return {
          content: 'Reasoning model response',
          usage: { totalTokens: 100 },
        };
      },
    };

    const executor = new AgentExecutor(mockAdapter);
    const runner = new AgentRunner(
      [agentInstance],
      undefined,
      { defaultModel: { model: 'gpt-4o' } },
      localToolProvider,
      moduleRef,
      executor,
    );

    const result: AgentResult = await runner.run('frugal-support-agent', {
      sessionId: 'sess_frugal_1',
      message: 'Where is my package?',
    });

    assert(result.output.includes('Your order #12345 has shipped!'), 'AgentRunner executes cascaded turn correctly');
  } catch (err: unknown) {
    assert(false, 'AgentRunner cascade integration', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} FrugalGPT model cascading test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} FrugalGPT model cascading tests passed successfully.\n`);
}
