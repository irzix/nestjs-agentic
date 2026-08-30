import type { ModelMessage } from '../interfaces/model.interface';
import { MessageReducerContractError } from '../errors';

/**
 * A cheap structural fingerprint of a transcript, captured before a reducer
 * runs so a mutation of the shared input can be detected after.
 */
export type TranscriptFingerprint = string;

/**
 * Snapshots the transcript's shape so {@link validateReduction} can tell whether
 * a reducer edited the shared input in place, which the contract forbids.
 *
 * Captures the fields that matter to the model request — role, content, and
 * tool-call/tool identity — not object identity, so a reducer returning a fresh
 * array of equivalent messages is not flagged.
 */
export function fingerprintTranscript(messages: readonly ModelMessage[]): TranscriptFingerprint {
  return JSON.stringify(messages.map(shapeOf));
}

function shapeOf(message: ModelMessage): unknown {
  switch (message.role) {
    case 'assistant':
      return ['a', message.content, (message.toolCalls ?? []).map((c) => [c.id, c.name])];
    case 'tool':
      return ['t', message.toolCallId, message.toolName, message.content];
    default:
      return [message.role[0], message.content];
  }
}

/**
 * Verifies that a reducer's output honors the tool protocol before it is sent
 * to a provider. Throws {@link MessageReducerContractError} on the first
 * violation; returns nothing on success.
 *
 * The rules mirror what providers enforce on a request:
 * - every `role: "tool"` message must be preceded, within the array, by the
 *   assistant `toolCalls` message that requested that `toolCallId` (no orphan
 *   results);
 * - every retained assistant tool-call must keep a `role: "tool"` result for
 *   each of its `toolCalls` (no incomplete group);
 * - a pending-approval group, when one is active, must be retained;
 * - the reducer must not mutate the input transcript in place.
 *
 * @param reduced Messages returned by the reducer.
 * @param original The transcript handed to the reducer.
 * @param originalFingerprint Fingerprint of `original` captured before the
 *   reducer ran, from {@link fingerprintTranscript}.
 * @param pendingApprovalToolCallId When set, the group that must survive.
 */
export function validateReduction(
  reduced: readonly ModelMessage[],
  original: readonly ModelMessage[],
  originalFingerprint: TranscriptFingerprint,
  pendingApprovalToolCallId?: string,
): void {
  if (fingerprintTranscript(original) !== originalFingerprint) {
    throw new MessageReducerContractError(
      'the reducer mutated the input transcript in place; it must return a new array and ' +
        'leave the messages it was given unchanged.',
    );
  }

  if (reduced === original) {
    // Identity: the reducer returned the untouched input. Nothing more to check.
    return;
  }

  const requestedIds = new Set<string>();
  const resultIds = new Set<string>();

  for (const message of reduced) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        requestedIds.add(call.id);
      }
    }
  }

  for (const message of reduced) {
    if (message.role !== 'tool') continue;

    if (!requestedIds.has(message.toolCallId)) {
      throw new MessageReducerContractError(
        `tool result "${message.toolCallId}" (${message.toolName}) has no matching ` +
          `assistant tool-call message; an orphan tool result is rejected by providers.`,
      );
    }
    resultIds.add(message.toolCallId);
  }

  for (const id of requestedIds) {
    if (!resultIds.has(id)) {
      throw new MessageReducerContractError(
        `assistant tool-call "${id}" is missing its matching tool result; a tool-call ` +
          `group must be kept or dropped whole, never split.`,
      );
    }
  }

  if (pendingApprovalToolCallId && !resultIds.has(pendingApprovalToolCallId)) {
    throw new MessageReducerContractError(
      `the pending-approval group "${pendingApprovalToolCallId}" was dropped; the active ` +
        `approval group and its toolCallId must be preserved so the turn can resume.`,
    );
  }
}
