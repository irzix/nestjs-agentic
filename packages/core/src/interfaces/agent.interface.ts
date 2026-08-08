import type { ModelConfig } from './runtime.interface';

export interface AgentConfig {
  instructions: string;
  /** ToolSet instances to expose as tools to the LLM. */
  tools: object[];
  /**
   * Sub-agents that this agent can delegate work to.
   * Each sub-agent is automatically wrapped as a ResolvedTool.
   * @future Multi-agent orchestration — implementation planned for v0.2.
   */
  subAgents?: AgentProvider[];
  /** Override the default model defined in AgenticModule.forRoot(). */
  model?: ModelConfig;
}

export interface AgentProvider {
  define(): AgentConfig;
}
