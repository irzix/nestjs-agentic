import { Agent } from 'nestjs-agentic';
import type { AgentConfig, AgentProvider } from 'nestjs-agentic';
import { BankingTools } from './banking.tools';

@Agent({
  name: 'banking-agent',
  description: 'Enterprise Banking & Financial Transaction Agent',
})
export class BankingAgent implements AgentProvider {
  constructor(private readonly bankingTools: BankingTools) {}

  define(): AgentConfig {
    return {
      instructions:
        'You are an enterprise financial officer AI assistant. Help users transfer funds securely. Always confirm account numbers and amounts.',
      tools: [this.bankingTools],
    };
  }
}
