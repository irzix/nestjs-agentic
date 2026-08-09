import { Global, Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from '@nestjs-agentic/core';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';
import { InventoryAgent } from './agent/inventory.agent';
import { InventoryAccessPolicy } from './policies/inventory-access.policy';
import { InventoryTools } from './tools/inventory.tools';

@Global()
@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    }),
    AgenticModule.forFeature({
      agents: [InventoryAgent],
      toolSets: [InventoryTools],
      policies: [InventoryAccessPolicy],
    }),
  ],
  providers: [
    {
      provide: RUNTIME_ADAPTER,
      useClass: LangGraphRuntimeAdapter,
    },
  ],
  exports: [RUNTIME_ADAPTER],
})
export class AppModule {}
