import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { AccountsModule } from '../accounts/accounts.module';
import { GovernanceModule } from '../governance/governance.module';
import { TenantIsolationPolicy } from '../governance/policies/tenant-isolation.policy';
import { TieredTransferPolicy } from '../governance/policies/tiered-transfer.policy';
import { BankingAgent } from './banking.agent';
import { BankingController } from './banking.controller';
import { BankingTools } from './banking.tools';

@Module({
  imports: [
    AccountsModule,
    GovernanceModule,
    AgenticModule.forFeature({
      agents: [BankingAgent],
      toolSets: [BankingTools],
      policies: [TenantIsolationPolicy, TieredTransferPolicy],
    }),
  ],
  controllers: [BankingController],
})
export class BankingModule {}
