import { Injectable } from '@nestjs/common';
import {
  Context,
  Param,
  Tool,
  ToolSet,
  UsePolicies,
} from '@nestjs-agentic/core';
import type { AgentContext } from '@nestjs-agentic/core';
import { InventoryAccessPolicy } from '../policies/inventory-access.policy';

@Injectable()
@ToolSet({ name: 'inventory-tools', tags: ['warehouse', 'logistics'] })
@UsePolicies(InventoryAccessPolicy)
export class InventoryTools {
  private stockMap = new Map<string, number>([
    ['SKU-101', 150],
    ['SKU-202', 45],
    ['SKU-303', 0],
  ]);

  @Tool({ name: 'checkStock', description: 'Checks current stock for a given SKU' })
  async checkStock(
    @Param('sku', { description: 'Stock keeping unit ID', type: 'string', required: true }) sku: string,
    @Context() ctx: AgentContext,
  ) {
    const qty = this.stockMap.get(sku) ?? 0;
    return {
      sku,
      availableQty: qty,
      tenantId: ctx.security.tenantId,
      requestedBy: ctx.security.userId,
    };
  }

  @Tool({ name: 'reserveStock', description: 'Reserves inventory items for an order' })
  async reserveStock(
    @Param('sku', { description: 'SKU ID', type: 'string', required: true }) sku: string,
    @Param('quantity', { description: 'Quantity to reserve', type: 'number', required: true }) quantity: number,
    @Context() ctx: AgentContext,
  ) {
    const current = this.stockMap.get(sku) ?? 0;
    if (current < quantity) {
      return { success: false, reason: `Insufficient stock for ${sku}. Available: ${current}` };
    }

    this.stockMap.set(sku, current - quantity);
    return {
      success: true,
      sku,
      reservedQty: quantity,
      remainingStock: current - quantity,
      tenantId: ctx.security.tenantId,
    };
  }
}
