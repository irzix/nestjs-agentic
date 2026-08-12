import type { ExecutionLimits } from './execution.interface';
import type { ModelConfig } from './runtime.interface';

export interface AgentConfig {
  instructions: string;
  /** ToolSet instances to expose as tools to the LLM. */
  tools: object[];
  /**
   * Sub-agents that this agent can delegate work to.
   * Not executed automatically by AgentRunner in the current release; use
   * `@nestjs-agentic/orchestration` for explicit delegation.
   */
  subAgents?: AgentProvider[];
  /** Override the default model defined in AgenticModule.forRoot(). */
  model?: ModelConfig;
  /**
   * Execution budgets applied when the built-in runtime runs this agent.
   * Overrides module-level limits and can be overridden per run.
   */
  limits?: ExecutionLimits;
}

export interface AgentProvider {
  define(): AgentConfig;
}
