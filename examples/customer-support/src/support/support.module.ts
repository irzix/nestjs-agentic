import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { OrderModule } from '../order/order.module';
import { RefundLimitPolicy } from '../order/policies/refund-limit.policy';
import { OrderTools } from '../order/tools/order.tools';
import { SupportAgent } from './agents/support.agent';
import { SupportController } from './support.controller';

@Module({
  imports: [
    OrderModule,
    // Agents, their tool sets, and policies must be registered in a single
    // forFeature() call so they share one module context and can inject
    // each other.
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
  controllers: [SupportController],
})
export class SupportModule {}
