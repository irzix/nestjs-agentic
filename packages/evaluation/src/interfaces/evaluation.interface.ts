import type { AgentResult, ToolCallRecord } from '@nestjs-agentic/core';

export interface EvalDatasetItem {
  id: string;
  query: string;
  /** Expected ground truth output string or key facts. */
  expectedOutput?: string;
  /** List of forbidden tool names or policy restrictions. */
  forbiddenTools?: string[];
  /** Maximum expected tool execution steps. */
  maxAllowedSteps?: number;
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
  score: number; // 0.0 to 1.0
  reason?: string;
}

export interface EvalMetric {
  name: string;
  evaluate(item: EvalDatasetItem, result: AgentResult): Promise<MetricResult> | MetricResult;
}

export interface EvalItemResult {
  item: EvalDatasetItem;
  agentResult: AgentResult;
  metrics: MetricResult[];
  overallPassed: boolean;
  score: number;
}

export interface BenchmarkSummary {
  totalItems: number;
  passedItems: number;
  failedItems: number;
  passRate: number; // 0.0 to 1.0
  averageScore: number;
  itemResults: EvalItemResult[];
}
