import type {
  AgentTrajectory,
  ReflectionResult,
  TrajectoryStep,
} from '../interfaces/experience.interface';

/**
 * Configurable severity weights for cognitive importance scoring in trajectory reflection.
 */
export interface ReflectionSeverityWeights {
  /** Importance score for security, authorization, and permission violations. Default: 0.95 */
  securityAndAuth?: number;
  /** Importance score for financial, ledger, and payment errors. Default: 0.90 */
  financialAndLedger?: number;
  /** Importance score for tooling, package manager, and dependency errors. Default: 0.70 */
  toolingAndEnvironment?: number;
  /** Importance score for rate limits, throttling, and network timeouts. Default: 0.60 */
  rateLimitsAndTimeouts?: number;
  /** Default baseline importance score for general unclassified failures. Default: 0.50 */
  generalFailure?: number;
  /** Importance score for successful execution trajectories. Default: 0.30 */
  successTrajectory?: number;
}

/**
 * Options configuring the trajectory reflection engine.
 */
export interface ReflectionEngineOptions {
  /** Configurable severity weights for cognitive importance scoring */
  severityWeights?: ReflectionSeverityWeights;
  /** Custom classifier hook allowing domain-specific importance inference */
  customClassifier?: (step: TrajectoryStep, errorDetail: string) => number | undefined;
}

/**
 * Production implementation of Trajectory Reflection and Self-Correction Critique.
 * Implements the Reflexion framework (Shinn et al., MIT, NeurIPS 2023) to analyze
 * execution trajectories, detect tool failures, and infer cognitive importance ratings.
 *
 * @see Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (arXiv:2303.11366)
 */
export class ReflectionEngine {
  private readonly weights: Required<ReflectionSeverityWeights>;
  private readonly customClassifier?: (step: TrajectoryStep, errorDetail: string) => number | undefined;

  constructor(options?: ReflectionEngineOptions) {
    this.weights = {
      securityAndAuth: options?.severityWeights?.securityAndAuth ?? 0.95,
      financialAndLedger: options?.severityWeights?.financialAndLedger ?? 0.90,
      toolingAndEnvironment: options?.severityWeights?.toolingAndEnvironment ?? 0.70,
      rateLimitsAndTimeouts: options?.severityWeights?.rateLimitsAndTimeouts ?? 0.60,
      generalFailure: options?.severityWeights?.generalFailure ?? 0.50,
      successTrajectory: options?.severityWeights?.successTrajectory ?? 0.30,
    };
    this.customClassifier = options?.customClassifier;
  }

  /**
   * Analyzes an agent execution trajectory, detects tool execution errors,
   * critiques failures (Reflexion pattern), and extracts actionable lessons learned
   * with severity-based cognitive importance ratings.
   *
   * @param trajectory The captured execution trajectory.
   * @returns Detailed critique, extracted self-correction lessons, and importance score.
   */
  async critiqueTrajectory(trajectory: AgentTrajectory): Promise<ReflectionResult> {
    const failedSteps = trajectory.steps.filter((s) => {
      if (Boolean(s.error)) return true;
      if (s.result && typeof s.result === 'object') {
        const res = s.result as Record<string, unknown>;
        return res.success === false;
      }
      return false;
    });

    if (failedSteps.length === 0 && trajectory.success) {
      return {
        success: true,
        critique: 'Execution completed cleanly without errors.',
        lessonsLearned: [],
        importance: this.weights.successTrajectory,
      };
    }

    const lessonsLearned: string[] = [];
    const critiques: string[] = [];

    let maxImportance = this.weights.generalFailure;

    for (const failedStep of failedSteps) {
      const toolName = failedStep.toolName ?? 'unknown_tool';
      const resObj =
        failedStep.result && typeof failedStep.result === 'object'
          ? (failedStep.result as Record<string, unknown>)
          : undefined;

      const errDetail =
        failedStep.error ??
        (typeof resObj?.reason === 'string' ? resObj.reason : undefined) ??
        (typeof resObj?.message === 'string' ? resObj.message : undefined) ??
        JSON.stringify(failedStep.result);

      const critiqueStr = `Tool "${toolName}" failed on step ${failedStep.stepIndex}: ${errDetail}`;
      critiques.push(critiqueStr);

      const errLower = errDetail.toLowerCase();

      // Check custom classifier first if provided
      if (this.customClassifier) {
        const customScore = this.customClassifier(failedStep, errDetail);
        if (typeof customScore === 'number' && !Number.isNaN(customScore)) {
          maxImportance = Math.max(maxImportance, Math.min(1.0, Math.max(0.0, customScore)));
        }
      }

      // Automated Reflection pattern extraction & Cognitive Importance assignment
      if (errLower.includes('npm') && errLower.includes('pnpm')) {
        lessonsLearned.push(`Use "pnpm" package manager instead of "npm" for this project.`);
        maxImportance = Math.max(maxImportance, this.weights.toolingAndEnvironment);
      } else if (
        errLower.includes('permission') ||
        errLower.includes('role') ||
        errLower.includes('finance_officer') ||
        errLower.includes('unauthorized') ||
        errLower.includes('forbidden')
      ) {
        lessonsLearned.push(`Verify required authorization role (e.g. finance_officer) before invoking "${toolName}".`);
        maxImportance = Math.max(maxImportance, this.weights.securityAndAuth);
      } else if (
        errLower.includes('transfer') ||
        errLower.includes('ledger') ||
        errLower.includes('payment') ||
        errLower.includes('balance')
      ) {
        lessonsLearned.push(`Validate account balance and transaction idempotency before calling "${toolName}".`);
        maxImportance = Math.max(maxImportance, this.weights.financialAndLedger);
      } else if (
        errLower.includes('rate') ||
        errLower.includes('limit') ||
        errLower.includes('timeout') ||
        errLower.includes('throttle')
      ) {
        lessonsLearned.push(`Throttle tool calls or wait before retrying "${toolName}".`);
        maxImportance = Math.max(maxImportance, this.weights.rateLimitsAndTimeouts);
      } else {
        lessonsLearned.push(`Verify input parameters and precondition checks for tool "${toolName}": ${errDetail}`);
      }
    }

    const suggestedPromptAdjustment = lessonsLearned.length > 0
      ? `[Experience Guidance]: ${lessonsLearned.join(' ')}`
      : undefined;

    return {
      success: false,
      critique: critiques.join(' | '),
      lessonsLearned,
      suggestedPromptAdjustment,
      importance: maxImportance,
    };
  }
}
