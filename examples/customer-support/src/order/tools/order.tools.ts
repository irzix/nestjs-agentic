import { Context, Param, Tool, ToolSet, UsePolicies } from 'nestjs-agentic';
import type { AgentContext } from 'nestjs-agentic';
import { RefundLimitPolicy } from '../policies/refund-limit.policy';
import { OrderService } from '../order.service';

@ToolSet({ name: 'order', tags: ['order', 'sales'] })
export class OrderTools {
  constructor(private readonly orderService: OrderService) {}

  @Tool({ description: 'Look up customer order details' })
  async getOrder(
    @Param('orderId', { description: 'The order ID', required: true }) orderId: string,
    @Context() ctx: AgentContext,
  ) {
    return this.orderService.findById(orderId, ctx.security.userId);
  }

  @Tool({ description: 'Request a refund for an order' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(
    @Param('orderId', { description: 'The order ID', required: true }) orderId: string,
    @Param('amount', { type: 'number', description: 'Amount to refund', required: true })
    amount: number,
  ) {
    return this.orderService.refund(orderId, amount);
  }
}
