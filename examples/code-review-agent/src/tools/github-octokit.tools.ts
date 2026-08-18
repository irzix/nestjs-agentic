import { Injectable } from '@nestjs/common';
import {
  AgentContext,
  Context,
  Param,
  Tool,
  ToolSet,
  UsePolicies,
} from 'nestjs-agentic';
import { ProtectedPathsPolicy } from '../policies/protected-paths.policy';
import { RequireMaintainerApprovalPolicy } from '../policies/require-maintainer-approval.policy';

/**
 * Toolset exposing GitHub API operations for pull request inspection,
 * comment posting, and automated branch modifications.
 */
@Injectable()
@ToolSet({ name: 'github' })
export class GitHubTools {
  /**
   * Fetches the unified diff of a targeted pull request.
   */
  @Tool({
    name: 'fetch_pr_diff',
    description: 'Fetches the unified git diff for a specific pull request in the repository.',
  })
  async fetchPrDiff(
    @Param('repo') repo: string,
    @Param('prNumber', { type: 'number' }) prNumber: number,
    @Context() ctx: AgentContext,
  ) {
    return {
      repo,
      prNumber,
      requestedBy: ctx.security.userId,
      diff: `diff --git a/src/orders/orders.service.ts b/src/orders/orders.service.ts\n+export class OrderService {}`,
    };
  }

  /**
   * Posts an inline review comment on a specific line of a pull request diff.
   */
  @Tool({
    name: 'post_inline_review_comment',
    description: 'Posts an inline review comment on a specific file and line number in the pull request.',
  })
  async postInlineReviewComment(
    @Param('filePath') filePath: string,
    @Param('line', { type: 'number' }) line: number,
    @Param('body') body: string,
    @Context() ctx: AgentContext,
  ) {
    return {
      success: true,
      filePath,
      line,
      commentId: `cmt_${Date.now()}`,
      author: ctx.security.userId,
    };
  }

  /**
   * Creates a dedicated fix branch and commits code patch modifications.
   * Intercepted by ProtectedPathsPolicy and RequireMaintainerApprovalPolicy.
   */
  @Tool({
    name: 'git_create_branch_and_commit',
    description: 'Creates a fix branch and commits automated code patches to resolve pull request review findings.',
  })
  @UsePolicies(ProtectedPathsPolicy, RequireMaintainerApprovalPolicy)
  async gitCreateBranchAndCommit(
    @Param('branchName') branchName: string,
    @Param('filePath') filePath: string,
    @Param('patchContent') patchContent: string,
    @Context() ctx: AgentContext,
  ) {
    return {
      success: true,
      branchName,
      filePath,
      commitSha: `commit_${Date.now()}`,
      author: ctx.security.userId,
    };
  }
}
