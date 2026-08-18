import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { GitHubWebhookPayload } from '../interfaces/webhook.interface';

/**
 * Service or function providing collaborator status checks.
 */
export type CollaboratorCheckerFn = (username: string, repo: string) => Promise<boolean> | boolean;

/**
 * Ensures that bot actions can only be triggered by authorized repository collaborators
 * to prevent prompt injection and unauthorized execution budget consumption.
 */
@Injectable()
export class CollaboratorGuard implements CanActivate {
  private readonly checkerFn?: CollaboratorCheckerFn;
  private readonly allowedUsers: Set<string>;

  constructor(options?: { checkerFn?: CollaboratorCheckerFn; allowedUsers?: string[] }) {
    this.checkerFn = options?.checkerFn;
    this.allowedUsers = new Set(options?.allowedUsers || ['maintainer', 'admin', 'irzix', 'collaborator']);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const payload = request.body as GitHubWebhookPayload;

    const sender = payload?.sender?.login || payload?.comment?.user?.login;
    const repo = payload?.repository?.full_name || 'unknown/repo';

    if (!sender) {
      throw new ForbiddenException('Unable to extract sender from webhook payload');
    }

    if (this.checkerFn) {
      const isAllowed = await this.checkerFn(sender, repo);
      if (!isAllowed) {
        throw new ForbiddenException(`User @${sender} is not an authorized collaborator on ${repo}`);
      }
      return true;
    }

    if (!this.allowedUsers.has(sender.toLowerCase())) {
      throw new ForbiddenException(`User @${sender} is not an authorized collaborator`);
    }

    return true;
  }
}
