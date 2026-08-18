import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { OpenAiModelAdapter } from '@nestjs-agentic/openai';
import { OpenAIEmbeddingAdapter, MockEmbeddingProvider } from '@nestjs-agentic/rag';
import { EMBEDDING_PROVIDER } from './rag/embedding.tokens';
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

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined);
const model = process.env.MODEL_NAME || (process.env.OPENROUTER_API_KEY ? 'openai/gpt-4o' : 'gpt-4o');

/**
 * Instantiates a real OpenAI-compatible embedding adapter targeting
 * `perplexity/pplx-embed-v1-0.6b` via OpenRouter when an API key is present.
 * Falls back to `MockEmbeddingProvider` for local / CI environments.
 */
const embeddingModel = process.env.EMBEDDING_MODEL || 'perplexity/pplx-embed-v1-0.6b';
const embeddingProvider = apiKey
  ? new OpenAIEmbeddingAdapter({
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: embeddingModel,
    })
  : new MockEmbeddingProvider();

/**
 * Main application module for Njent Code Review and Governance Agent.
 */
@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: {
        model,
        provider: 'openai',
      },
      modelAdapter: apiKey
        ? new OpenAiModelAdapter({
            apiKey,
            baseUrl,
          })
        : undefined,
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
    {
      provide: EMBEDDING_PROVIDER,
      useValue: embeddingProvider,
    },
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
