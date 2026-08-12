import { Agent } from 'nestjs-agentic';
import type { AgentConfig, AgentProvider } from 'nestjs-agentic';
import { OrderTools } from '../../order/tools/order.tools';

@Agent({
  name: 'customer-support',
  description: 'Handles order lookup and refund inquiries',
})
export class SupportAgent implements AgentProvider {
  constructor(private readonly orderTools: OrderTools) {}

  define(): AgentConfig {
    return {
      instructions: 'You are a helpful customer support assistant.',
      tools: [this.orderTools],
    };
  }
}
