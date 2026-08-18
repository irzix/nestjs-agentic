import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { WebhookController, NJENT_REVIEW_SERVICE } from './webhooks/webhook.controller';
import { ApprovalController } from './controllers/approval.controller';
import { GitHubSignatureGuard } from './guards/github-signature.guard';
import { CollaboratorGuard } from './guards/collaborator.guard';
import { RateLimiterGuard } from './guards/rate-limiter.guard';
import { CodebaseRAGService } from './rag/codebase-rag.service';
import { SecurityReviewerAgent } from './agents/security-reviewer.agent';
import { ArchitectureReviewerAgent } from './agents/architecture-reviewer.agent';
import { QualityReviewerAgent } from './agents/quality-reviewer.agent';
import { LeadSynthesizerAgent } from './agents/lead-synthesizer.agent';
import { CodeFixerAgent } from './agents/code-fixer.agent';
import { ConsensusEvaluatorService } from './orchestration/consensus-evaluator.service';
import { PrReviewOrchestrator } from './orchestration/pr-review.orchestrator';
import { ProtectedPathsPolicy } from './policies/protected-paths.policy';
import { RequireMaintainerApprovalPolicy } from './policies/require-maintainer-approval.policy';
import { GitHubTools } from './tools/github-octokit.tools';
import { ReviewQualityEvaluatorService } from './evaluation/review-quality-evaluator.service';
import { NjentExperienceService } from './memory/experience-learner.service';
import { NjentAuditLogger } from './audit/njent-audit-logger.service';

/**
 * Main application module for Njent Code Review and Governance Agent.
 */
@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: {
        model: 'gpt-4o',
        provider: 'openai',
      },
      approvalTtlSeconds: 86400,
    }),
    AgenticModule.forFeature({
      agents: [
        SecurityReviewerAgent,
        ArchitectureReviewerAgent,
        QualityReviewerAgent,
        LeadSynthesizerAgent,
        CodeFixerAgent,
      ],
      toolSets: [GitHubTools],
      policies: [ProtectedPathsPolicy, RequireMaintainerApprovalPolicy],
    }),
  ],
  controllers: [WebhookController, ApprovalController],
  providers: [
    GitHubSignatureGuard,
    CollaboratorGuard,
    RateLimiterGuard,
    CodebaseRAGService,
    ConsensusEvaluatorService,
    PrReviewOrchestrator,
    ReviewQualityEvaluatorService,
    NjentExperienceService,
    NjentAuditLogger,
    {
      provide: NJENT_REVIEW_SERVICE,
      useExisting: PrReviewOrchestrator,
    },
  ],
  exports: [
    PrReviewOrchestrator,
    CodebaseRAGService,
    ReviewQualityEvaluatorService,
    NjentExperienceService,
  ],
})
export class NjentAppModule {}
