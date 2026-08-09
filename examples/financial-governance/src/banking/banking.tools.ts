import { Context, Param, Tool, ToolSet, UsePolicies } from 'nestjs-agentic';
import type { AgentContext } from 'nestjs-agentic';
import { AccountService } from '../accounts/account.service';
import { TenantIsolationPolicy } from '../governance/policies/tenant-isolation.policy';
import { TieredTransferPolicy } from '../governance/policies/tiered-transfer.policy';

@ToolSet({ name: 'banking', tags: ['finance', 'transfers'] })
export class BankingTools {
  constructor(private readonly accountService: AccountService) {}

  @Tool({ description: 'Transfer funds between bank accounts safely with policy governance' })
  @UsePolicies(TenantIsolationPolicy, TieredTransferPolicy)
  async transferFunds(
    @Param('fromAccount') fromAccount: string,
    @Param('toAccount') toAccount: string,
    @Param('amount') amount: number,
    @Context() ctx: AgentContext,
  ) {
    return this.accountService.transfer(
      fromAccount,
      toAccount,
      amount,
      ctx.security.tenantId,
    );
  }
}
