import { Global, Module } from '@nestjs/common';
import { AgenticModule, MockRuntimeAdapter, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { BankingModule } from './banking/banking.module';

@Global()
@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'deterministic' },
    }),
    BankingModule,
  ],
  providers: [
    { provide: RUNTIME_ADAPTER, useClass: MockRuntimeAdapter },
  ],
  exports: [
    RUNTIME_ADAPTER,
  ],
})
export class AppModule {}
