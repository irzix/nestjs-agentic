import type { ModelMessage } from './model.interface';

export interface SessionStore {
  get(sessionId: string): Promise<unknown | null>;
  set(sessionId: string, data: unknown): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

/**
 * Conversation state the built-in runtime keeps per session.
 *
 * Stored through `SessionStore`, so the shape must stay serializable.
 * System messages are not stored, because agent instructions are applied again
 * on every turn.
 */
export interface SessionRecord {
  sessionId: string;
  messages: ModelMessage[];
  updatedAt: string;
}

export interface SessionOptions {
  /**
   * Replay and persist conversation history per session.
   * Only applies to the built-in runtime. Default: true
   */
  enabled?: boolean;
  /**
   * Maximum messages retained per session, counted after a turn ends.
   * Oldest messages are dropped first. Default: 40
   */
  maxMessages?: number;
}

export const DEFAULT_SESSION_MAX_MESSAGES = 40;

/** Narrows a stored value to a usable conversation record. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as SessionRecord).messages)
  );
}
