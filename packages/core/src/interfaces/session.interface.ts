export interface SessionStore {
  get(sessionId: string): Promise<unknown | null>;
  set(sessionId: string, data: unknown): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
