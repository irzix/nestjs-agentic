import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { OrderModule } from '../order/order.module';
import { SupportAgent } from './agents/support.agent';
import { SupportController } from './support.controller';

@Module({
  imports: [
    OrderModule,
    AgenticModule.forFeature({
      agents: [SupportAgent],
    }),
  ],
  controllers: [SupportController],
})
export class SupportModule {}
