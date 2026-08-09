import { Injectable } from '@nestjs/common';
import { Agent, AgentProvider } from '@nestjs-agentic/core';
import type { AgentConfig } from '@nestjs-agentic/core';
import { InventoryTools } from '../tools/inventory.tools';

@Injectable()
@Agent({
  name: 'inventory-agent',
  description: 'Warehouse Inventory Management Agent executing via LangGraph state machine',
})
export class InventoryAgent implements AgentProvider {
  constructor(private readonly inventoryTools: InventoryTools) {}

  define(): AgentConfig {
    return {
      instructions: 'You are an inventory management assistant.',
      tools: [this.inventoryTools],
    };
  }
}
