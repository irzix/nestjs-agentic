import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';

/**
 * Validates the GitHub HMAC-SHA256 signature on incoming webhook requests.
 * Uses timingSafeEqual to protect against side-channel timing attacks.
 */
@Injectable()
export class GitHubSignatureGuard implements CanActivate {
  private readonly secret: string;

  constructor(@Optional() secret?: string) {
    this.secret = secret || process.env.GITHUB_WEBHOOK_SECRET || 'test-secret';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-hub-signature-256'] as string;

    if (!signature) {
      throw new UnauthorizedException('Missing X-Hub-Signature-256 header');
    }

    const payload = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body);

    const hmac = crypto.createHmac('sha256', this.secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const digestBuffer = Buffer.from(digest, 'utf8');

    if (
      signatureBuffer.length !== digestBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, digestBuffer)
    ) {
      throw new UnauthorizedException('Invalid GitHub Webhook HMAC signature');
    }

    return true;
  }
}
