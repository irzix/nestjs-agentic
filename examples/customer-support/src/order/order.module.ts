import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { RefundLimitPolicy } from './policies/refund-limit.policy';
import { OrderService } from './order.service';
import { OrderTools } from './tools/order.tools';

@Module({
  imports: [
    AgenticModule.forFeature({
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
  providers: [OrderService],
  exports: [OrderService, OrderTools],
})
export class OrderModule {}
