import type { AgentResult, AgentRunInput, AgentStreamEvent, RuntimeAdapter } from '../interfaces';

interface ToolScenario {
  toolName: string;
  args: Record<string, unknown>;
}

export interface MockWhenAskedBuilder {
  thenCallTool(toolName: string, args?: Record<string, unknown>): MockRuntimeAdapter;
}

export class MockRuntimeAdapter implements RuntimeAdapter {
  private readonly scenarios = new Map<string, ToolScenario>();

  whenAsked(message: string): MockWhenAskedBuilder {
    return {
      thenCallTool: (toolName: string, args: Record<string, unknown> = {}): MockRuntimeAdapter => {
        this.scenarios.set(message, { toolName, args });
        return this;
      },
    };
  }

  reset(): void {
    this.scenarios.clear();
  }

  async execute(input: AgentRunInput): Promise<AgentResult> {
    const scenario = this.scenarios.get(input.message);

    if (scenario) {
      const tool = input.tools.find((t) => t.name === scenario.toolName);

      if (!tool) {
        throw new Error(
          `MockRuntimeAdapter: tool "${scenario.toolName}" was not found in the agent's tool list. ` +
            `Available tools: [${input.tools.map((t) => t.name).join(', ')}]`,
        );
      }

      const result = await tool.execute({ args: scenario.args });

      return {
        sessionId: input.sessionId,
        output: `Mock executed tool "${scenario.toolName}"`,
        toolCalls: [{ toolName: scenario.toolName, args: scenario.args, result }],
      };
    }

    return {
      sessionId: input.sessionId,
      output: `Mock response: "${input.message}"`,
      toolCalls: [],
    };
  }

  async *stream(input: AgentRunInput): AsyncIterable<AgentStreamEvent> {
    const scenario = this.scenarios.get(input.message);

    if (scenario) {
      const tool = input.tools.find((t) => t.name === scenario.toolName);
      if (!tool) {
        throw new Error(
          `MockRuntimeAdapter: tool "${scenario.toolName}" was not found in the agent's tool list.`,
        );
      }

      yield { type: 'tool_start', toolName: scenario.toolName, args: scenario.args };

      const result = await tool.execute({ args: scenario.args });

      if (!result.success && result.status === 'pending_approval') {
        yield {
          type: 'approval_required',
          toolName: scenario.toolName,
          approvalId: result.approvalId,
          reason: result.reason,
        };
      } else {
        yield { type: 'tool_result', toolName: scenario.toolName, result };
      }

      const text = `Mock executed tool "${scenario.toolName}"`;
      yield { type: 'token', text };
      yield { type: 'complete', sessionId: input.sessionId, output: text };
      return;
    }

    const text = `Mock response: "${input.message}"`;
    yield { type: 'token', text };
    yield { type: 'complete', sessionId: input.sessionId, output: text };
  }
}
