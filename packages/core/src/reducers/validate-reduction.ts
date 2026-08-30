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
 * Captures the fields sent to the model — role, content, and the full tool-call
 * identity *and arguments* — so a reducer that mutates a nested `args` object in
 * place is caught, not just one that reassigns a top-level field.
 */
export function fingerprintTranscript(messages: readonly ModelMessage[]): TranscriptFingerprint {
  return JSON.stringify(messages.map(shapeOf));
}

/** Reduces one message to the model-relevant fields the fingerprint compares. */
function shapeOf(message: ModelMessage): unknown {
  switch (message.role) {
    case 'assistant':
      return [
        'a',
        message.content,
        (message.toolCalls ?? []).map((c) => [c.id, c.name, c.args]),
      ];
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
 * The transcript is walked sequentially so ordering and group ownership are
 * enforced, not just set membership — providers reject a result that precedes
 * its request or one whose group was split by an unrelated message:
 *
 * - An assistant `toolCalls` message opens a group; the `role: "tool"` messages
 *   that immediately follow must resolve exactly that group's call ids, with no
 *   other message type interleaved before every id is answered.
 * - A `role: "tool"` message that does not resolve an open group is an orphan
 *   (it either precedes its request or belongs to an already-closed group).
 * - A tool-call id may not be declared twice.
 * - A group left with unanswered calls when the next non-tool message or the end
 *   of the array is reached is incomplete.
 * - A pending-approval group, when one is active, must survive as a resolved
 *   group.
 * - The reducer must not mutate the input transcript in place.
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

  const seenCallIds = new Set<string>();
  const declaredCallIds = new Set<string>();
  // Ids requested by the assistant group currently being resolved, still awaiting
  // their tool result. Order is not required among a group's own results.
  let openGroup: Set<string> | null = null;
  // Whether the currently open group declared the pending-approval id, tracked
  // separately because that id is removed from `openGroup` once its result is
  // consumed.
  let openGroupHoldsApproval = false;

  // A suspended turn legitimately produces a trailing group where the calls
  // after the withheld one never ran: `applyModelRound` returns as soon as one
  // call reports `pending_approval`. That incomplete group is only ever the last
  // one in the transcript and always belongs to the pending-approval group, so it
  // is the single exception to the "every group must be complete" rule.
  const closeGroupOrThrow = (isFinal: boolean) => {
    if (openGroup && openGroup.size > 0) {
      const allowedTrailingSuspension = isFinal && openGroupHoldsApproval;

      if (!allowedTrailingSuspension) {
        const missing = [...openGroup].join(', ');
        throw new MessageReducerContractError(
          `assistant tool-call group is missing results for: ${missing}; a tool-call group ` +
            `must be kept or dropped whole, and its results must directly follow it.`,
        );
      }
    }
    openGroup = null;
  };

  for (const message of reduced) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      // A new group cannot open while the previous one is unresolved.
      closeGroupOrThrow(false);

      openGroup = new Set();
      openGroupHoldsApproval = false;
      for (const call of message.toolCalls) {
        if (seenCallIds.has(call.id)) {
          throw new MessageReducerContractError(
            `tool-call id "${call.id}" appears more than once; each tool call must be unique.`,
          );
        }
        seenCallIds.add(call.id);
        declaredCallIds.add(call.id);
        openGroup.add(call.id);
        if (call.id === pendingApprovalToolCallId) {
          openGroupHoldsApproval = true;
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      if (!openGroup || !openGroup.has(message.toolCallId)) {
        throw new MessageReducerContractError(
          `tool result "${message.toolCallId}" (${message.toolName}) does not directly follow ` +
            `the assistant tool-call that requested it; an orphan or out-of-order tool result ` +
            `is rejected by providers.`,
        );
      }
      openGroup.delete(message.toolCallId);
      continue;
    }

    // A system/user/plain-assistant message ends any open group; it must be
    // fully resolved by now (it is not the trailing suspension group).
    closeGroupOrThrow(false);
  }

  closeGroupOrThrow(true);

  // The pending-approval group must be preserved. It is enough that its
  // assistant tool-call was declared — the result may be withheld (suspension)
  // or resolved (resume); either way the group is present.
  if (pendingApprovalToolCallId && !declaredCallIds.has(pendingApprovalToolCallId)) {
    throw new MessageReducerContractError(
      `the pending-approval group "${pendingApprovalToolCallId}" was dropped; the active ` +
        `approval group and its toolCallId must be preserved so the turn can resume.`,
    );
  }
}
