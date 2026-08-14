import type { ModelMessage } from '../interfaces/model.interface';

/**
 * Trims a conversation to the most recent messages without leaving a dangling
 * tool exchange.
 *
 * Providers reject a `tool` message that is not preceded by the assistant
 * message that requested it, and an assistant message whose tool results were
 * dropped. A naive slice can produce either, so the boundary is moved forward
 * until the history starts on a message that can safely open a request.
 */
export function trimHistory(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  if (maxMessages <= 0) return [];

  const recent =
    messages.length > maxMessages ? messages.slice(messages.length - maxMessages) : [...messages];

  let start = 0;
  while (start < recent.length && !opensCleanly(recent[start])) {
    start++;
  }

  return start === 0 ? recent : recent.slice(start);
}

function opensCleanly(message: ModelMessage): boolean {
  if (message.role === 'tool') return false;
  if (message.role === 'assistant') return !message.toolCalls?.length;
  return true;
}

/** Drops system messages, which are re-applied from agent instructions each turn. */
export function withoutSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((message) => message.role !== 'system');
}
