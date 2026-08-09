import { Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { AdkRuntimeAdapter } from '@nestjs-agentic/adk';
import { OrderModule } from './order/order.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    }),
    OrderModule,
    SupportModule,
  ],
  providers: [
    { provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter },
  ],
})
export class AppModule {}
