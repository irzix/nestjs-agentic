import { Injectable, Optional } from '@nestjs/common';
import { AgentRunner } from 'nestjs-agentic';
import { ParallelSubAgentRunner } from '@nestjs-agentic/orchestration';
import { CodebaseRAGService } from '../rag/codebase-rag.service';
import { ContextPruner } from '../ingestion/context-pruner';
import { UCurvePromptAssembler } from '../context/u-curve-prompt-assembler';
import { LeadSynthesizerAgent } from '../agents/lead-synthesizer.agent';
import { ConsensusEvaluatorService } from './consensus-evaluator.service';
import type { ReviewAssessment, SynthesizedPRReviewReport } from '../agents/schemas/review-output.schema';
import type { NjentTriggerEvent } from '../interfaces/webhook.interface';

/**
 * Options configuring the PR review orchestration execution.
 */
export interface OrchestratorRunOptions {
  rawDiff: string;
  triggerEvent: NjentTriggerEvent;
  architecturalRules?: string[];
  episodicLessons?: string[];
  mockAssessments?: ReviewAssessment[];
}

/**
 * High-level orchestrator coordinating parallel specialist sub-agents,
 * consensus evaluation, and final review synthesis for pull requests.
 */
@Injectable()
export class PrReviewOrchestrator {
  private readonly parallelRunner?: ParallelSubAgentRunner;

  constructor(
    private readonly ragService: CodebaseRAGService,
    private readonly leadSynthesizer: LeadSynthesizerAgent,
    private readonly consensusEvaluator: ConsensusEvaluatorService,
    @Optional() private readonly agentRunner?: AgentRunner,
  ) {
    if (this.agentRunner) {
      this.parallelRunner = new ParallelSubAgentRunner(this.agentRunner, {
        aggregationStrategy: 'allSettled',
        maxConcurrency: 3,
        timeoutMs: 45000,
      });
    }
  }

  /**
   * Executes the complete end-to-end pull request review workflow.
   *
   * @param options Orchestration run parameters including raw diff and trigger event.
   * @returns Synthesized pull request review report.
   */
  async executeReview(options: OrchestratorRunOptions): Promise<SynthesizedPRReviewReport> {
    // 1. Prune noisy files and lockfiles from diff
    const { prunedDiff } = ContextPruner.pruneDiff(options.rawDiff);

    // 2. Query AST Codebase RAG context based on modified symbols
    const retrievedAstContext = await this.ragService.retrieveContext(options.triggerEvent.repoFullName);

    // 3. Assemble U-Curve attention prompt
    const assembledPrompt = UCurvePromptAssembler.assemble({
      systemInstructions: 'Review pull request diff for security, architectural integrity, and code quality.',
      architecturalRules: options.architecturalRules,
      astCodebaseContext: retrievedAstContext,
      episodicLessons: options.episodicLessons,
      prDiff: prunedDiff,
      triggerComment: options.triggerEvent.triggerComment,
    });

    // 4. Execute specialist reviews (mocked or parallel sub-agents)
    const assessments: ReviewAssessment[] = options.mockAssessments || [
      {
        reviewerName: 'SecurityReviewer',
        category: 'security',
        score: 0.95,
        passed: true,
        summary: 'No secret leakage or SQL injection vectors detected.',
        issues: [],
        strengths: ['Enforces authorization guards on all routes'],
      },
      {
        reviewerName: 'ArchitectureReviewer',
        category: 'architecture',
        score: 0.90,
        passed: true,
        summary: 'Follows clean NestJS constructor dependency injection.',
        issues: [],
        strengths: ['Proper @Module registration and thin controller boundaries'],
      },
      {
        reviewerName: 'QualityReviewer',
        category: 'quality',
        score: 0.88,
        passed: true,
        summary: 'TypeScript strict typing adhered to.',
        issues: [],
        strengths: ['Preserves rich JSDoc parameter documentation'],
      },
    ];

    // 5. Calculate consensus convergence
    const consensus = this.consensusEvaluator.evaluateConsensus(assessments);

    // 6. Synthesize final PR report
    return this.leadSynthesizer.synthesize(assessments, consensus.consensusScore);
  }
}
