import { randomUUID } from 'crypto';
import type { StateStore } from '@nestjs-agentic/core';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

export interface ShortTermMemoryOptions {
  maxMessages?: number;
  stateStore?: StateStore;
  keyPrefix?: string;
}

export class ShortTermMemory implements AgentMemoryStore {
  private readonly stateStore?: StateStore;
  private readonly maxMessages: number;
  private readonly keyPrefix: string;
  private readonly fallbackMemory = new Map<string, MemoryRecord[]>();

  constructor(options?: ShortTermMemoryOptions) {
    this.maxMessages = options?.maxMessages ?? 20;
    this.stateStore = options?.stateStore;
    this.keyPrefix = options?.keyPrefix ?? 'memory:short_term:';
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async save(record: MemoryRecord): Promise<void> {
    if (record.type && record.type !== 'short_term') {
      return;
    }

    const item: MemoryRecord = {
      ...record,
      type: 'short_term',
      id: record.id || randomUUID(),
      timestamp: record.timestamp || new Date(),
    };

    if (this.stateStore) {
      const existing = (await this.stateStore.get<MemoryRecord[]>(this.getKey(record.sessionId))) ?? [];
      existing.push(item);
      if (existing.length > this.maxMessages) {
        existing.splice(0, existing.length - this.maxMessages);
      }
      await this.stateStore.set(this.getKey(record.sessionId), existing);
    } else {
      const sessionRecords = this.fallbackMemory.get(record.sessionId) ?? [];
      sessionRecords.push(item);
      if (sessionRecords.length > this.maxMessages) {
        sessionRecords.splice(0, sessionRecords.length - this.maxMessages);
      }
      this.fallbackMemory.set(record.sessionId, sessionRecords);
    }
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    let sessionRecords: MemoryRecord[] = [];

    if (options?.sessionId) {
      if (this.stateStore) {
        sessionRecords = (await this.stateStore.get<MemoryRecord[]>(this.getKey(options.sessionId))) ?? [];
      } else {
        sessionRecords = this.fallbackMemory.get(options.sessionId) ?? [];
      }
    } else {
      if (this.stateStore) {
        sessionRecords = [];
      } else {
        sessionRecords = Array.from(this.fallbackMemory.values()).flat();
      }
    }

    const filtered = sessionRecords.filter((r) =>
      r.content.toLowerCase().includes(query.toLowerCase()),
    );

    return filtered.slice(-(options?.limit ?? this.maxMessages));
  }

  async clear(sessionId?: string): Promise<void> {
    if (sessionId) {
      if (this.stateStore) {
        await this.stateStore.delete(this.getKey(sessionId));
      } else {
        this.fallbackMemory.delete(sessionId);
      }
    } else if (this.stateStore?.clear) {
      await this.stateStore.clear(this.keyPrefix);
    } else {
      this.fallbackMemory.clear();
    }
  }

  async getWindow(sessionId: string): Promise<MemoryRecord[]> {
    if (this.stateStore) {
      return (await this.stateStore.get<MemoryRecord[]>(this.getKey(sessionId))) ?? [];
    }
    return this.fallbackMemory.get(sessionId) ?? [];
  }
}
