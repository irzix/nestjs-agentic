import { randomUUID } from 'crypto';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord, SemanticMatch, SemanticStoreProvider } from '../interfaces/memory.interface';

export interface SemanticMemoryOptions {
  provider?: SemanticStoreProvider;
}

export class BasicSemanticStore implements SemanticStoreProvider {
  private readonly records: MemoryRecord[] = [];

  async save(record: MemoryRecord): Promise<void> {
    this.records.push(record);
  }

  async search(query: string, limit = 5): Promise<SemanticMatch[]> {
    const queryTokens = new Set(query.toLowerCase().split(/\s+/));
    const scored = this.records.map((record) => {
      const tokens = record.content.toLowerCase().split(/\s+/);
      let matchCount = 0;
      for (const t of tokens) {
        if (queryTokens.has(t)) matchCount++;
      }
      const score = matchCount / Math.max(tokens.length, 1);
      return { record, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, limit);
  }
}

export class SemanticMemory implements AgentMemoryStore {
  private readonly provider: SemanticStoreProvider;

  constructor(options?: SemanticMemoryOptions) {
    this.provider = options?.provider ?? new BasicSemanticStore();
  }

  async save(record: MemoryRecord): Promise<void> {
    if (record.type && record.type !== 'semantic') {
      return;
    }
    const item: MemoryRecord = {
      ...record,
      type: 'semantic',
      id: record.id || randomUUID(),
      timestamp: record.timestamp || new Date(),
    };
    await this.provider.save(item);
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    const matches = await this.provider.search(query, options?.limit ?? 10);
    let records = matches.map((m) => m.record);
    if (options?.sessionId) {
      records = records.filter((r) => r.sessionId === options.sessionId);
    }
    return records;
  }
}
