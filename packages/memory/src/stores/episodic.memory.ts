import { randomUUID } from 'crypto';
import type { AgentMemoryStore, MemoryQueryOptions, MemoryRecord } from '../interfaces/memory.interface';

export class EpisodicMemory implements AgentMemoryStore {
  private readonly episodes = new Map<string, MemoryRecord[]>();

  async save(record: MemoryRecord): Promise<void> {
    if (record.type && record.type !== 'episodic') {
      return;
    }
    const item: MemoryRecord = {
      ...record,
      type: 'episodic',
      id: record.id || randomUUID(),
      timestamp: record.timestamp || new Date(),
    };

    const sessionEpisodes = this.episodes.get(record.sessionId) ?? [];
    sessionEpisodes.push(item);
    this.episodes.set(record.sessionId, sessionEpisodes);
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    let list: MemoryRecord[] = [];
    if (options?.sessionId) {
      list = this.episodes.get(options.sessionId) ?? [];
    } else {
      list = Array.from(this.episodes.values()).flat();
    }

    const filtered = list.filter((r) =>
      r.content.toLowerCase().includes(query.toLowerCase()),
    );
    return filtered.slice(0, options?.limit ?? 50);
  }

  async clear(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.episodes.delete(sessionId);
    } else {
      this.episodes.clear();
    }
  }

  /**
   * Retrieves timeline of past execution episodes for a session.
   */
  async getTimeline(sessionId: string): Promise<MemoryRecord[]> {
    return this.episodes.get(sessionId) ?? [];
  }
}
