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
const model = process.env.MODEL_NAME || process.env.OPENAI_MODEL_NAME || 'gpt-4o';

/**
 * Instantiates an OpenAI-compatible embedding adapter using the user-specified
 * EMBEDDING_MODEL env var (e.g. perplexity/pplx-embed-v1-0.6b or text-embedding-3-small).
 * Falls back to MockEmbeddingProvider for local / CI environments when no API key is set.
 */
const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const embeddingProvider = apiKey
  ? new OpenAIEmbeddingAdapter({
      apiKey,
      baseUrl: baseUrl || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined),
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
      // Global execution guardrails to prevent runaway token costs and infinite loops
      limits: {
        // Cumulative token budget across prompt input, parallel sub-agents, and debate rounds
        maxTotalTokens: parseInt(process.env.MAX_TOTAL_TOKENS || '16000', 10),
        // Maximum interaction rounds per turn
        maxIterations: 4,
        // Overall execution timeout in milliseconds (45s)
        timeoutMs: 45000,
      },
      modelAdapter: apiKey
        ? new OpenAiModelAdapter({
            apiKey,
            baseUrl,
            // Output token cap: 2500 tokens ensures full JSON assessments and inline suggestions without mid-generation truncation
            maxTokens: Math.max(1000, Math.min(8000, parseInt(process.env.MAX_TOKENS || '2500', 10) || 2500)),
            maxCompletionTokens: Math.max(1000, Math.min(8000, parseInt(process.env.MAX_TOKENS || '2500', 10) || 2500)),
            // Low temperature for deterministic, structured JSON review outputs
            temperature: 0.1,
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
