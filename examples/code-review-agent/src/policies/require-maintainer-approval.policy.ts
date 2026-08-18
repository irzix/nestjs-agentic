import { Injectable } from '@nestjs/common';
import { AgentContext, PolicyResult, ToolPolicy } from 'nestjs-agentic';

/**
 * Governance policy intercepting side-effecting GitHub mutations (creating branches, committing code patches)
 * and triggering a durable human-in-the-loop (HITL) approval suspension.
 */
@Injectable()
export class RequireMaintainerApprovalPolicy implements ToolPolicy {
  private static readonly MUTATING_TOOLS = new Set([
    'git_create_branch_and_commit',
    'push_code_patch',
    'approve_pull_request',
    'merge_pull_request',
  ]);

  async evaluate(
    _ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    if (RequireMaintainerApprovalPolicy.MUTATING_TOOLS.has(toolName)) {
      const target = args.branchName || args.filePath || 'pull request';
      return {
        decision: 'require_approval',
        reason: `Executing mutating action "${toolName}" on "${target}" requires maintainer authorization.`,
      };
    }

    return { decision: 'allow' };
  }
}
