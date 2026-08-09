import { Module } from '@nestjs/common';
import { TenantIsolationPolicy } from './policies/tenant-isolation.policy';
import { TieredTransferPolicy } from './policies/tiered-transfer.policy';

@Module({
  providers: [TenantIsolationPolicy, TieredTransferPolicy],
  exports: [TenantIsolationPolicy, TieredTransferPolicy],
})
export class GovernanceModule {}
