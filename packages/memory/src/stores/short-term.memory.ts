import { randomUUID } from 'crypto';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

export interface ShortTermMemoryOptions {
  maxMessages?: number;
}

export class ShortTermMemory implements AgentMemoryStore {
  private readonly records = new Map<string, MemoryRecord[]>();
  private readonly maxMessages: number;

  constructor(options?: ShortTermMemoryOptions) {
    this.maxMessages = options?.maxMessages ?? 20;
  }

  async save(record: MemoryRecord): Promise<void> {
    const sessionRecords = this.records.get(record.sessionId) ?? [];
    sessionRecords.push({
      ...record,
      id: record.id || randomUUID(),
      timestamp: record.timestamp || new Date(),
    });

    if (sessionRecords.length > this.maxMessages) {
      sessionRecords.splice(0, sessionRecords.length - this.maxMessages);
    }

    this.records.set(record.sessionId, sessionRecords);
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    if (!options?.sessionId) {
      return Array.from(this.records.values())
        .flat()
        .filter((r) => r.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, options?.limit ?? 10);
    }

    const sessionRecords = this.records.get(options.sessionId) ?? [];
    const filtered = sessionRecords.filter((r) =>
      r.content.toLowerCase().includes(query.toLowerCase()),
    );

    return filtered.slice(-(options.limit ?? this.maxMessages));
  }

  async clear(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.records.delete(sessionId);
    } else {
      this.records.clear();
    }
  }

  /**
   * Helper utility to retrieve ordered message window for a session.
   */
  async getWindow(sessionId: string): Promise<MemoryRecord[]> {
    return this.records.get(sessionId) ?? [];
  }
}
