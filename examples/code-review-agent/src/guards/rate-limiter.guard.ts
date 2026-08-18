import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { GitHubWebhookPayload } from '../interfaces/webhook.interface';

/**
 * Sliding-window in-memory rate limiter per PR (max N executions per window).
 */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly timestamps = new Map<string, number[]>();

  constructor(options?: { maxRequests?: number; windowMs?: number }) {
    this.maxRequests = options?.maxRequests ?? 5;
    this.windowMs = options?.windowMs ?? 3600000; // 1 hour default
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const payload = request.body as GitHubWebhookPayload;

    const prNumber = payload?.pull_request?.number || payload?.issue?.number || payload?.number;
    const repo = payload?.repository?.full_name || 'default';
    const key = `${repo}#${prNumber}`;

    const now = Date.now();
    const history = (this.timestamps.get(key) || []).filter(
      (ts) => now - ts < this.windowMs,
    );

    if (history.length >= this.maxRequests) {
      throw new HttpException(
        `Rate limit exceeded: Max ${this.maxRequests} reviews per PR per hour`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    history.push(now);
    this.timestamps.set(key, history);
    return true;
  }
}
