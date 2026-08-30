import type { ModelMessage } from './model.interface';

/**
 * Context passed to an {@link AgentMessageReducer} on each model round.
 *
 * Everything here is derived from the turn the executor is running, so a
 * reducer can key its bounded projection per execution, per session, or per
 * iteration without holding state across turns.
 */
export interface AgentMessageReductionContext {
  /** Unique identifier of the turn currently executing. */
  executionId: string;
  /** Conversation the turn belongs to. */
  sessionId: string;
  /**
   * Zero-based index of the model round about to be sent. `0` is the first
   * round of the turn, before any tool group has been appended.
   */
  iteration: number;
  /** Name of the `@Agent` running the turn, when known. */
  agentName?: string;
  /** Cancellation signal owned by the executor. An async reducer should honor it. */
  signal?: AbortSignal;
  /**
   * When the turn is being resumed from an approval, the `toolCallId` of the
   * group that was suspended. The reducer must keep this group and its exact
   * `toolCallId` intact so resume can continue. Absent on a fresh turn.
   */
  pendingApprovalToolCallId?: string;
}

/**
 * A provider-agnostic projection applied between the canonical execution
 * transcript and the messages actually sent to the model on each round.
 *
 * The executor keeps one append-only transcript per turn — used for audit,
 * approval resume, and checkpoints — and sends it verbatim to the model by
 * default. A reducer lets an application bound what the model sees each round
 * (for example, folding older tool groups into a compact run-state message)
 * without altering that canonical transcript.
 *
 * The reducer runs before the model request is observed, so `onModelRequest`
 * receives the exact messages the adapter receives.
 *
 * ## Contract
 *
 * A reducer shapes context for the model; it is not free to produce an
 * arbitrary message list. The framework validates the returned array and
 * rejects a reduction that would violate the tool protocol, because providers
 * reject such payloads:
 *
 * - An assistant `toolCalls` message and every matching `role: "tool"` result
 *   form one atomic group. A retained assistant tool-call must keep all of its
 *   results, and no `role: "tool"` message may remain without the assistant
 *   message that requested it (no orphan tool results).
 * - Parallel tool calls in one assistant message are one group: keep or drop
 *   them together.
 * - When {@link AgentMessageReductionContext.pendingApprovalToolCallId} is set,
 *   that group and its `toolCallId` must be preserved.
 * - The reducer must not mutate the input array or any message object; it must
 *   return a new array (or the same reference unchanged for identity behavior).
 *
 * @example
 * ```typescript
 * class KeepLatestToolGroupReducer implements AgentMessageReducer {
 *   reduce(messages: readonly ModelMessage[]): readonly ModelMessage[] {
 *     // Application-specific bounded projection goes here.
 *     return messages;
 *   }
 * }
 *
 * AgenticModule.forRoot({ messageReducer: new KeepLatestToolGroupReducer() });
 * ```
 */
export interface AgentMessageReducer {
  /**
   * @param messages The canonical transcript for this round, oldest first.
   *   Treated as read-only.
   * @param context Identity and resume information for the current round.
   * @returns The messages to send to the model this round. Must satisfy the
   *   tool-group invariants above.
   */
  reduce(
    messages: readonly ModelMessage[],
    context: AgentMessageReductionContext,
  ): readonly ModelMessage[] | Promise<readonly ModelMessage[]>;
}
