import type { AgentResult, ToolCallRecord } from '@nestjs-agentic/core';

export interface EvalDatasetItem {
  id: string;
  query: string;
  /** Expected ground truth output string or key facts. */
  expectedOutput?: string;
  /** Expected tool execution sequence (e.g. ['checkBalance', 'transferFunds']). */
  expectedToolSequence?: string[];
  /** Expected tool argument assertions (e.g. { transferFunds: { amount: 500 } }). */
  expectedToolArgs?: Record<string, Record<string, unknown>>;
  /** List of forbidden tool names or policy restrictions. */
  forbiddenTools?: string[];
  /** Maximum expected tool execution steps limit. Default: 5 */
  maxAllowedSteps?: number;
  /** Maximum expected token consumption limit. Default: 4000 */
  maxAllowedTokens?: number;
  /** Maximum expected latency in milliseconds. Default: 10000 */
  maxAllowedLatencyMs?: number;
  /** Context overrides or user roles for benchmark execution. */
  context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
    data?: Record<string, unknown>;
  };
}

export interface MetricResult {
  metricName: string;
  passed: boolean;
  score: number; // 0.0 to 1.0 (mathematical float)
  reason?: string;
  details?: Record<string, unknown>;
}

export interface EvalMetric {
  name: string;
  evaluate(item: EvalDatasetItem, result: AgentResult): Promise<MetricResult> | MetricResult;
}

export interface MultiTrialResult {
  scores: number[];
  meanScore: number;
  standardDeviation: number;
  passRate: number;
}

export interface EvalItemResult {
  item: EvalDatasetItem;
  agentResult: AgentResult;
  metrics: MetricResult[];
  overallPassed: boolean;
  score: number;
  multiTrialSummary?: MultiTrialResult;
}

export interface BenchmarkSummary {
  totalItems: number;
  passedItems: number;
  failedItems: number;
  passRate: number; // 0.0 to 1.0
  averageScore: number;
  overallVariance: number;
  itemResults: EvalItemResult[];
}
