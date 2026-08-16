export interface StateStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(prefix?: string): Promise<void>;
  /**
   * Atomically sets a value only if the key does not already exist (or has expired).
   * Returns `true` if the key was set, or `false` if it already existed.
   */
  setIfNotExists?<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<boolean>;
}

export const STATE_STORE = 'AGENTIC_STATE_STORE';
