import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { createModelAdapter, defaultModel } from './model.factory';
import { OrderModule } from './order/order.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel,
      // Registering a ModelAdapter activates the built-in agent runtime, which
      // owns the model-to-tool loop, argument validation, and budgets.
      modelAdapter: createModelAdapter(),
      limits: { maxIterations: 6, maxToolCalls: 8, timeoutMs: 60_000 },
    }),
    OrderModule,
    SupportModule,
  ],
})
export class AppModule {}
