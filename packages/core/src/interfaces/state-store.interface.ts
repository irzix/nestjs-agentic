export interface StateStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(prefix?: string): Promise<void>;
}

export const STATE_STORE = 'AGENTIC_STATE_STORE';
