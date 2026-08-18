import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GitHubSignatureGuard } from '../guards/github-signature.guard';
import { CollaboratorGuard } from '../guards/collaborator.guard';
import { RateLimiterGuard } from '../guards/rate-limiter.guard';
import type { GitHubWebhookPayload, NjentTriggerEvent } from '../interfaces/webhook.interface';

/**
 * Interface for background review dispatch service.
 */
export interface INjentReviewService {
  handleTrigger(event: NjentTriggerEvent): Promise<void>;
}

export const NJENT_REVIEW_SERVICE = 'NJENT_REVIEW_SERVICE';

/**
 * Controller receiving GitHub Webhooks for pull requests and comments.
 * Verifies HMAC signatures, RBAC collaborator privileges, sliding-window rate limits,
 * and enforces delivery-level idempotency to prevent duplicate review runs.
 */
@Controller('webhooks')
@UseGuards(GitHubSignatureGuard, CollaboratorGuard, RateLimiterGuard)
export class WebhookController {
  private readonly processedDeliveries = new Set<string>();

  constructor(
    @Optional()
    @Inject(NJENT_REVIEW_SERVICE)
    private readonly reviewService?: INjentReviewService,
  ) {}

  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(
    @Body() payload: GitHubWebhookPayload,
    @Headers('x-github-delivery') deliveryId?: string,
  ): Promise<{ status: string; event?: NjentTriggerEvent }> {
    // Enforce idempotency on duplicate GitHub deliveries
    if (deliveryId) {
      if (this.processedDeliveries.has(deliveryId)) {
        return { status: 'duplicate_ignored' };
      }
      this.processedDeliveries.add(deliveryId);

      // Keep cache size bounded
      if (this.processedDeliveries.size > 2000) {
        const first = this.processedDeliveries.values().next().value;
        if (first) this.processedDeliveries.delete(first);
      }
    }

    const event = this.parseEvent(payload);

    if (!event) {
      return { status: 'ignored' };
    }

    // Dispatch background processing asynchronously without blocking the HTTP ACK
    if (this.reviewService) {
      void this.reviewService.handleTrigger(event).catch((err) => {
        console.error('[Njent] Background review error:', err);
      });
    }

    return { status: 'accepted', event };
  }

  /**
   * Normalizes raw GitHub webhook payloads into structured NjentTriggerEvent.
   */
  private parseEvent(payload: GitHubWebhookPayload): NjentTriggerEvent | null {
    const action = payload.action;

    // 1. PR opened, synchronized, or reopened (ignore labeled, assigned, edited, closed, etc.)
    if (payload.pull_request) {
      if (action !== 'opened' && action !== 'synchronize' && action !== 'reopened') {
        return null;
      }

      const eventType: NjentTriggerEvent['eventType'] = action === 'synchronize'
        ? 'pr_synchronized'
        : 'pr_opened';

      return {
        eventType,
        repoFullName: payload.repository.full_name,
        prNumber: payload.pull_request.number,
        author: payload.pull_request.user.login,
        action: 'review',
        headSha: payload.pull_request.head.sha,
        baseSha: payload.pull_request.base.sha,
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Issue comment trigger (e.g. "@njent review", "@njent apply-fixes", "@njent false-positive")
    if (payload.comment && payload.issue?.pull_request) {
      // Only process newly created comments and ignore bots
      if (action !== 'created' && action !== undefined) {
        return null;
      }

      const authorLogin = payload.comment.user?.login || '';
      if (authorLogin.endsWith('[bot]') || payload.comment.user?.type === 'Bot') {
        return null;
      }

      const commentBody = payload.comment.body || '';
      const isReview = /@njent\s+review/i.test(commentBody);
      const isFix = /@njent\s+apply-fixes/i.test(commentBody);
      const isFalsePositive = /@njent\s+false-positive/i.test(commentBody);

      if (!isReview && !isFix && !isFalsePositive) {
        return null;
      }

      const triggerAction: NjentTriggerEvent['action'] = isFix
        ? 'apply_fixes'
        : isFalsePositive
        ? 'false_positive'
        : 'review';

      return {
        eventType: 'comment_trigger',
        repoFullName: payload.repository.full_name,
        prNumber: payload.issue.number,
        author: authorLogin,
        triggerComment: commentBody,
        action: triggerAction,
        headSha: 'HEAD',
        baseSha: 'BASE',
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }
}
