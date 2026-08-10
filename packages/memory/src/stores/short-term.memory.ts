import { randomUUID } from 'crypto';
import type { StateStore } from '@nestjs-agentic/core';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

/**
 * Configuration options for ShortTermMemory store.
 */
export interface ShortTermMemoryOptions {
  /** Maximum number of recent conversation messages to retain per session before pruning. Default: `20` */
  maxMessages?: number;

  /** Optional core StateStore instance (e.g. RedisStateStore, InMemoryStateStore) for centralized state persistence. */
  stateStore?: StateStore;

  /** Cache/State key prefix for storing short-term session records. Default: `'memory:short_term:'` */
  keyPrefix?: string;
}

/**
 * Short-Term memory store maintaining sliding-window conversation history for active session contexts.
 */
export class ShortTermMemory implements AgentMemoryStore {
  private readonly stateStore?: StateStore;
  private readonly maxMessages: number;
  private readonly keyPrefix: string;
  private readonly fallbackMemory = new Map<string, MemoryRecord[]>();

  /**
   * Creates a new instance of ShortTermMemory.
   * @param options Configuration options.
   */
  constructor(options?: ShortTermMemoryOptions) {
    this.maxMessages = options?.maxMessages ?? 20;
    this.stateStore = options?.stateStore;
    this.keyPrefix = options?.keyPrefix ?? 'memory:short_term:';
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Saves a conversation record into the short-term sliding-window memory store.
   * Automatically prunes oldest messages when history exceeds maxMessages.
   */
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

  /**
   * Recalls conversation records matching a text search query for the given session.
   */
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

  /**
   * Clears stored conversation history for a single session or all sessions.
   */
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

  /**
   * Retrieves the full active sliding-window array of conversation records for a session.
   */
  async getWindow(sessionId: string): Promise<MemoryRecord[]> {
    if (this.stateStore) {
      return (await this.stateStore.get<MemoryRecord[]>(this.getKey(sessionId))) ?? [];
    }
    return this.fallbackMemory.get(sessionId) ?? [];
  }
}
