import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';
import type { AgenticInternalContext, CapabilityNarrowing } from '../interfaces/orchestration.interface';

/**
 * Built-in governance policy that enforces delegated capability whitelists and blacklists.
 */
export class CapabilityNarrowingPolicy implements ToolPolicy {
  async evaluate(
    ctx: AgentContext,
    toolName: string,
  ): Promise<PolicyResult> {
    const agentic = ctx.data?.agentic as AgenticInternalContext | undefined;
    const narrowing: CapabilityNarrowing | undefined =
      agentic?.capabilityNarrowing ??
      (ctx.data?.__capabilityNarrowing as CapabilityNarrowing | undefined);

    if (!narrowing) {
      return { decision: 'allow' };
    }

    // 1. Blacklist check (Blacklist takes strict precedence over whitelist)
    if (narrowing.deniedTools && narrowing.deniedTools.includes(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is prohibited by the delegated deniedTools capability blacklist.`,
      };
    }

    // 2. Whitelist check (If allowedTools is defined, tool must be in whitelist)
    if (narrowing.allowedTools && !narrowing.allowedTools.includes(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is not permitted under the delegated allowedTools capability whitelist.`,
      };
    }

    return { decision: 'allow' };
  }
}
