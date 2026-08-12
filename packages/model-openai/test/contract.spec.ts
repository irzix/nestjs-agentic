import { CONTRACT_USER_MESSAGE, runModelAdapterContract } from '@nestjs-agentic/core';
import type { ModelAdapterContractScenario } from '@nestjs-agentic/core';
import { OpenAiModelAdapter } from '../src';

/**
 * Serves the scripted round over the real Chat Completions wire format, so the
 * SDK performs its own request building and stream decoding.
 */
function scriptedFetch(scenario: ModelAdapterContractScenario) {
  return async (_input: any, init?: any): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const usage = scenario.usage
      ? {
          prompt_tokens: scenario.usage.inputTokens,
          completion_tokens: scenario.usage.outputTokens,
          total_tokens: scenario.usage.totalTokens,
        }
      : undefined;

    const toolCalls = (scenario.toolCalls ?? []).map((call, index) => ({
      index,
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    }));

    if (!body.stream) {
      return jsonResponse({
        choices: [
          {
            index: 0,
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
            message: {
              role: 'assistant',
              content: scenario.content ?? null,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
          },
        ],
        ...(usage ? { usage } : {}),
      });
    }

    const frames: string[] = [];
    for (const token of (scenario.content ?? '').split(/(?=\s)/).filter(Boolean)) {
      frames.push(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: token } }] })}\n\n`,
      );
    }
    for (const call of toolCalls) {
      frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] } }] })}\n\n`);
    }
    frames.push(
      `data: ${JSON.stringify({
        choices: [{ index: 0, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop', delta: {} }],
        ...(usage ? { usage } : {}),
      })}\n\n`,
      'data: [DONE]\n\n',
    );

    return sseResponse(frames);
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function main() {
  console.log('📜 Running @nestjs-agentic/openai Contract Compliance...\n');

  const result = await runModelAdapterContract({
    name: 'OpenAiModelAdapter',
    model: { provider: 'openai', model: 'gpt-4o-mini' },
    createAdapter: (scenario) =>
      new OpenAiModelAdapter({
        apiKey: 'sk-contract',
        maxRetries: 0,
        clientOptions: { fetch: scriptedFetch(scenario) as any },
      }),
  });

  // The harness keys its scripted provider on this message, so a drifting
  // constant would silently weaken the suite.
  console.log(`  ℹ️  contract prompt: "${CONTRACT_USER_MESSAGE}"`);

  if (result.failed > 0) {
    console.error(`\n❌ TEST SUITE FAILURE: ${result.failed} contract violations.`);
    for (const failure of result.failures) {
      console.error(`   - ${failure}`);
    }
    process.exit(1);
  }

  console.log('🎉 OPENAI ADAPTER IS CONTRACT COMPLIANT!\n');
}

main().catch((err) => {
  console.error('❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
