import { randomUUID } from 'crypto';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

export class ScratchpadMemory implements AgentMemoryStore {
  private readonly tasksMap = new Map<string, Map<string, MemoryRecord>>();

  async save(record: MemoryRecord): Promise<void> {
    const key = (record.metadata?.taskId as string) || record.id || randomUUID();
    let sessionMap = this.tasksMap.get(record.sessionId);
    if (!sessionMap) {
      sessionMap = new Map<string, MemoryRecord>();
      this.tasksMap.set(record.sessionId, sessionMap);
    }

    sessionMap.set(key, {
      ...record,
      type: 'scratchpad',
      timestamp: record.timestamp || new Date(),
    });
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    if (!options?.sessionId) {
      const all: MemoryRecord[] = [];
      for (const map of this.tasksMap.values()) {
        all.push(...map.values());
      }
      return all
        .filter((r) => r.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, options?.limit ?? 10);
    }

    const sessionMap = this.tasksMap.get(options.sessionId);
    if (!sessionMap) return [];

    const list = Array.from(sessionMap.values()).filter((r) =>
      r.content.toLowerCase().includes(query.toLowerCase()),
    );
    return list.slice(0, options.limit ?? 50);
  }

  async clear(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.tasksMap.delete(sessionId);
    } else {
      this.tasksMap.clear();
    }
  }

  /**
   * Retrieves all active working tasks/files for a given session.
   */
  async getWorkingSet(sessionId: string): Promise<MemoryRecord[]> {
    const sessionMap = this.tasksMap.get(sessionId);
    return sessionMap ? Array.from(sessionMap.values()) : [];
  }
}
