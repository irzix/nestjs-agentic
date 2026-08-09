import { Global, Module } from '@nestjs/common';
import { TenantIsolationPolicy } from './policies/tenant-isolation.policy';
import { TieredTransferPolicy } from './policies/tiered-transfer.policy';

@Global()
@Module({
  providers: [TenantIsolationPolicy, TieredTransferPolicy],
  exports: [TenantIsolationPolicy, TieredTransferPolicy],
})
export class GovernanceModule {}
