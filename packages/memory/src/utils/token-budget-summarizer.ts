import type { MemoryRecord } from '../interfaces/memory.interface';

export interface TokenBudgetOptions {
  maxTokenBudget?: number;
  charsPerToken?: number;
}

export class TokenBudgetSummarizer {
  private readonly maxTokenBudget: number;
  private readonly charsPerToken: number;

  constructor(options?: TokenBudgetOptions) {
    this.maxTokenBudget = options?.maxTokenBudget ?? 4000;
    this.charsPerToken = options?.charsPerToken ?? 4;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  summarizeRecords(records: MemoryRecord[]): MemoryRecord[] {
    const totalTokens = records.reduce((sum, r) => sum + this.estimateTokens(r.content), 0);
    if (totalTokens <= this.maxTokenBudget || records.length <= 2) {
      return records;
    }

    const toSummarize = records.slice(0, records.length - 2);
    const recent = records.slice(records.length - 2);

    const summaryContent = `[Summary of ${toSummarize.length} previous interactions: ${toSummarize
      .map((r) => r.content)
      .join(' | ')}]`;

    const summaryRecord: MemoryRecord = {
      id: `summary_${Date.now()}`,
      sessionId: records[0].sessionId,
      type: 'short_term',
      content: summaryContent,
      timestamp: new Date(),
    };

    return [summaryRecord, ...recent];
  }
}
