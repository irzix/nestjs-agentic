import type { AgentTrajectory, ReflectionResult } from '../interfaces/experience.interface';

export class ReflectionEngine {
  /**
   * Analyzes an agent execution trajectory, detects tool execution errors,
   * critiques failures (Reflexion pattern), and extracts actionable lessons learned.
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
      };
    }

    const lessonsLearned: string[] = [];
    const critiques: string[] = [];

    let maxImportance = 0.50; // Default baseline for general errors

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

      // Automated Reflection pattern extraction & Cognitive Importance assignment
      if (errLower.includes('npm') && errLower.includes('pnpm')) {
        lessonsLearned.push(`Use "pnpm" package manager instead of "npm" for this project.`);
        maxImportance = Math.max(maxImportance, 0.70);
      } else if (errLower.includes('permission') || errLower.includes('role') || errLower.includes('finance_officer') || errLower.includes('unauthorized')) {
        lessonsLearned.push(`Verify required authorization role (e.g. finance_officer) before invoking "${toolName}".`);
        maxImportance = Math.max(maxImportance, 0.95);
      } else if (errLower.includes('transfer') || errLower.includes('ledger') || errLower.includes('payment')) {
        lessonsLearned.push(`Validate account balance and transaction idempotency before calling "${toolName}".`);
        maxImportance = Math.max(maxImportance, 0.90);
      } else if (errLower.includes('rate') || errLower.includes('limit') || errLower.includes('timeout')) {
        lessonsLearned.push(`Throttle tool calls or wait before retrying "${toolName}".`);
        maxImportance = Math.max(maxImportance, 0.60);
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
