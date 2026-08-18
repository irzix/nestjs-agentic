import { Injectable } from '@nestjs/common';
import { AgentContext, PolicyResult, ToolPolicy } from 'nestjs-agentic';

/**
 * Deterministic policy preventing automated code fixer tools from modifying
 * protected infrastructure, CI workflows, and root configuration files.
 */
@Injectable()
export class ProtectedPathsPolicy implements ToolPolicy {
  private static readonly PROTECTED_PATTERNS = [
    /^\.github\/workflows\//i,
    /^package\.json$/i,
    /^package-lock\.json$/i,
    /^pnpm-lock\.yaml$/i,
    /^yarn\.lock$/i,
    /^tsconfig.*\.json$/i,
    /^SECURITY\.md$/i,
    /^LICENSE$/i,
  ];

  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const filePath = typeof args.filePath === 'string'
      ? args.filePath
      : typeof args.path === 'string'
      ? args.path
      : '';

    if (!filePath) {
      return { decision: 'allow' };
    }

    const isProtected = ProtectedPathsPolicy.PROTECTED_PATTERNS.some((pattern) => pattern.test(filePath));

    if (isProtected) {
      return {
        decision: 'deny',
        reason: `Automated modifications to protected path "${filePath}" are strictly denied by ProtectedPathsPolicy.`,
      };
    }

    return { decision: 'allow' };
  }
}
