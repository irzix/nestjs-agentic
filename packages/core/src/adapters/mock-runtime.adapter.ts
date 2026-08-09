import type { AgentResult, AgentRunInput, RuntimeAdapter } from '../interfaces';

interface ToolScenario {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * A test double for RuntimeAdapter that lets you define exactly which tool
 * the "agent" will call for a given message — without any LLM or network calls.
 *
 * Use this in unit tests to verify policy enforcement, HITL mechanics,
 * and tool invocation in isolation.
 *
 * @example
 * const mock = new MockRuntimeAdapter();
 * mock.whenAsked('Refund $600 for order #123')
 *     .thenCallTool('refundOrder', { orderId: '123', amount: 600 });
 *
 * const result = await runner.run('customer-support', {
 *   sessionId: 'test',
 *   message: 'Refund $600 for order #123',
 * });
 */
export class MockRuntimeAdapter implements RuntimeAdapter {
  private readonly scenarios = new Map<string, ToolScenario>();

  /**
   * Defines what tool the mock agent will call when it receives the given message.
   * Message matching is exact.
   */
  whenAsked(message: string) {
    return {
      thenCallTool: (toolName: string, args: Record<string, unknown> = {}) => {
        this.scenarios.set(message, { toolName, args });
        return this;
      },
    };
  }

  /** Removes all registered scenarios. Useful in beforeEach hooks. */
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

    // No matching scenario — return a neutral response without calling any tool.
    return {
      sessionId: input.sessionId,
      output: `Mock response: "${input.message}"`,
      toolCalls: [],
    };
  }
}
