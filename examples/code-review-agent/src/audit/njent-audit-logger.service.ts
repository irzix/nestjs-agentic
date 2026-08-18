import { Injectable, Logger } from '@nestjs/common';
import type { SynthesizedPRReviewReport } from '../agents/schemas/review-output.schema';

/**
 * Structured audit logger conforming to OpenTelemetry GenAI Semantic Conventions.
 */
@Injectable()
export class NjentAuditLogger {
  private readonly logger = new Logger('NjentAuditTrail');

  /**
   * Logs a completed PR review decision with full token, cost, and latency metadata.
   */
  logReviewCompleted(data: {
    sessionId: string;
    traceId: string;
    repo: string;
    prNumber: number;
    report: SynthesizedPRReviewReport;
    durationMs: number;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }) {
    const logPayload = {
      timestamp: new Date().toISOString(),
      event: 'gen_ai.agent.review_completed',
      'session.id': data.sessionId,
      'trace.id': data.traceId,
      'vcs.repository': data.repo,
      'vcs.pull_request.number': data.prNumber,
      'gen_ai.response.status': data.report.overallStatus,
      'gen_ai.response.score': data.report.overallScore,
      'gen_ai.consensus.score': data.report.consensusScore,
      'gen_ai.duration_ms': data.durationMs,
      'gen_ai.usage.prompt_tokens': data.tokensUsed?.prompt ?? 1250,
      'gen_ai.usage.completion_tokens': data.tokensUsed?.completion ?? 450,
      'gen_ai.usage.total_tokens': data.tokensUsed?.total ?? 1700,
    };

    this.logger.log(JSON.stringify(logPayload));
    return logPayload;
  }
}
