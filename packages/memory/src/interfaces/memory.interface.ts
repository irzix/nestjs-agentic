export interface MemoryRecord {
  id: string;
  sessionId: string;
  type: 'short_term' | 'scratchpad' | 'episodic' | 'semantic' | (string & {});
  content: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface MemoryQueryOptions {
  sessionId?: string;
  limit?: number;
  type?: string;
}

export interface AgentMemoryStore {
  save(record: MemoryRecord): Promise<void>;
  recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]>;
  clear?(sessionId?: string): Promise<void>;
}

export interface SemanticMatch {
  record: MemoryRecord;
  score: number;
}

export interface SemanticStoreProvider {
  save(record: MemoryRecord, embedding?: number[]): Promise<void>;
  search(query: string, limit?: number): Promise<SemanticMatch[]>;
}
