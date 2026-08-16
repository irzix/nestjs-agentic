import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';
import type { CapabilityNarrowing } from '../interfaces/orchestration.interface';

/**
 * Built-in governance policy that enforces delegated capability whitelists and blacklists.
 */
export class CapabilityNarrowingPolicy implements ToolPolicy {
  async evaluate(
    ctx: AgentContext,
    toolName: string,
  ): Promise<PolicyResult> {
    const narrowing = ctx.data?.__capabilityNarrowing as CapabilityNarrowing | undefined;
    if (!narrowing) {
      return { decision: 'allow' };
    }

    if (narrowing.allowedTools && !narrowing.allowedTools.includes(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is not permitted under the delegated allowedTools capability whitelist.`,
      };
    }

    if (narrowing.deniedTools && narrowing.deniedTools.includes(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is prohibited by the delegated deniedTools capability blacklist.`,
      };
    }

    return { decision: 'allow' };
  }
}
