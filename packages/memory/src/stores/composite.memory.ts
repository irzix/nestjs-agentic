import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

export class CompositeMemory implements AgentMemoryStore {
  constructor(private readonly stores: AgentMemoryStore[]) {}

  async save(record: MemoryRecord): Promise<void> {
    for (const store of this.stores) {
      await store.save(record);
    }
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const store of this.stores) {
      const records = await store.recall(query, options);
      results.push(...records);
    }

    const uniqueMap = new Map<string, MemoryRecord>();
    for (const r of results) {
      uniqueMap.set(r.id, r);
    }

    return Array.from(uniqueMap.values()).slice(0, options?.limit ?? 20);
  }

  async clear(sessionId?: string): Promise<void> {
    for (const store of this.stores) {
      if (store.clear) {
        await store.clear(sessionId);
      }
    }
  }
}
