import type { ExecutionLimits, ToolErrorHandling } from './execution.interface';
import type { ModelConfig } from './runtime.interface';
import type { CascadeConfig } from './cascade.interface';
import type { AgentMessageReducer } from './message-reducer.interface';

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
  /** FrugalGPT model cascading configuration (fastModel -> reasoningModel). */
  cascade?: CascadeConfig;
  /**
   * Execution budgets applied when the built-in runtime runs this agent.
   * Overrides module-level limits and can be overridden per run.
   */
  limits?: ExecutionLimits;
  /**
   * How exceptions thrown by this agent's tools are treated.
   * Overrides the module setting and can be overridden per run.
   */
  toolErrorHandling?: ToolErrorHandling;
  /**
   * Bounded projection applied to the transcript before each model round for
   * this agent's turns. Overrides the module default and can be overridden per
   * run. Shapes only what the model sees; the persisted transcript, checkpoints,
   * and approval resume stay unreduced.
   */
  messageReducer?: AgentMessageReducer;
}

export interface AgentProvider {
  define(): AgentConfig;
}
