/**
 * Bounds applied to a single agent turn.
 *
 * Limits are resolved per run with the following precedence:
 * run input, then agent config, then module options, then framework defaults.
 */
export interface ExecutionLimits {
  /** Maximum model rounds in one turn. Default: 10 */
  maxIterations?: number;
  /** Maximum tool invocations across the whole turn. Default: 32 */
  maxToolCalls?: number;
  /** Wall-clock budget for the turn. Unlimited when omitted. */
  timeoutMs?: number;
  /** Cumulative provider-reported token budget. Unlimited when omitted. */
  maxTotalTokens?: number;
}

/** Framework defaults used when no limits are configured. */
export const DEFAULT_EXECUTION_LIMITS: Required<
  Pick<ExecutionLimits, 'maxIterations' | 'maxToolCalls'>
> = {
  maxIterations: 10,
  maxToolCalls: 32,
};

/**
 * How the runtime treats an exception thrown by an application tool.
 *
 * - `report` feeds the error back to the model so it can adapt within the same
 *   turn, matching how invalid tool arguments are handled.
 * - `throw` propagates the error and ends the run.
 *
 * Framework errors such as a missing policy registration always propagate.
 */
export type ToolErrorHandling = 'report' | 'throw';

/** Default applied when no tool error strategy is configured. */
export const DEFAULT_TOOL_ERROR_HANDLING: ToolErrorHandling = 'report';

/** Reason an execution stopped before the model produced a final answer. */
export type ExecutionLimitKind =
  | 'max_iterations'
  | 'max_tool_calls'
  | 'timeout'
  | 'max_total_tokens';
