import type {
  AgentMessageReducer,
  AgentMessageReductionContext,
} from '../interfaces/message-reducer.interface';
import type { ModelMessage } from '../interfaces/model.interface';

/** Options for {@link BoundedToolHistoryReducer}. */
export interface BoundedToolHistoryOptions {
  /**
   * Number of most-recent complete tool groups kept verbatim. Older groups are
   * folded into one compact run-state message. Default: `1`.
   */
  keepLastToolGroups?: number;
  /**
   * Role used for the folded run-state summary. `user` is the safest default
   * because every provider accepts a plain user message in any position; some
   * reject a second system message mid-conversation. Default: `'user'`.
   */
  summaryRole?: 'user' | 'system';
}

/** One assistant tool-call message together with its matching tool results. */
interface ToolGroup {
  /** Index of the assistant tool-call message in the source array. */
  start: number;
  /** Index just past the last tool result of the group. */
  end: number;
  toolNames: string[];
  toolCallIds: string[];
}

/**
 * A deterministic, LLM-free context projector that bounds tool-loop growth.
 *
 * It keeps the last `keepLastToolGroups` complete tool groups verbatim and
 * folds every older completed group into a single compact message describing
 * what ran, so intermediate observations are paid for once rather than
 * re-sent on every later round. Non-tool messages (system, user, plain
 * assistant answers) are always kept in place.
 *
 * The projection is a view for the model only — the executor's canonical
 * transcript, approval-resume data, and checkpoints are untouched. The reducer
 * never mutates its input and always returns a new array (or the input
 * unchanged when nothing needs folding), and it always keeps the active
 * pending-approval group intact.
 *
 * @example
 * ```typescript
 * AgenticModule.forRoot({
 *   messageReducer: new BoundedToolHistoryReducer({ keepLastToolGroups: 1 }),
 * });
 * ```
 */
export class BoundedToolHistoryReducer implements AgentMessageReducer {
  private readonly keepLast: number;
  private readonly summaryRole: 'user' | 'system';

  constructor(options: BoundedToolHistoryOptions = {}) {
    const keep = options.keepLastToolGroups ?? 1;
    if (!Number.isInteger(keep) || keep < 0) {
      throw new TypeError(
        `BoundedToolHistoryReducer: keepLastToolGroups must be a non-negative integer, received ${String(
          keep,
        )}.`,
      );
    }
    this.keepLast = keep;
    this.summaryRole = options.summaryRole ?? 'user';
  }

  reduce(
    messages: readonly ModelMessage[],
    context: AgentMessageReductionContext,
  ): readonly ModelMessage[] {
    const groups = this.findToolGroups(messages);

    // Nothing to fold: fewer groups than the retention window.
    if (groups.length <= this.keepLast) {
      return messages;
    }

    // Never fold the pending-approval group even if it is old — resume needs it.
    let cutoff = groups.length - this.keepLast;
    if (context.pendingApprovalToolCallId) {
      const approvalGroup = groups.findIndex((g) =>
        g.toolCallIds.includes(context.pendingApprovalToolCallId!),
      );
      if (approvalGroup !== -1 && approvalGroup < cutoff) {
        cutoff = approvalGroup;
      }
    }

    if (cutoff <= 0) {
      return messages;
    }

    const foldedGroups = groups.slice(0, cutoff);
    const foldStart = foldedGroups[0].start;
    const foldEnd = foldedGroups[foldedGroups.length - 1].end;

    const summary = this.summarize(foldedGroups);

    // Keep everything before the first folded group (system, user, prior plain
    // assistant turns), then the summary, then everything from the first kept
    // group onward verbatim. A message inside [foldStart, foldEnd) that is not
    // part of a tool group cannot exist — groups are contiguous — so slicing by
    // index is safe.
    return [
      ...messages.slice(0, foldStart),
      { role: this.summaryRole, content: summary },
      ...messages.slice(foldEnd),
    ];
  }

  /**
   * Walks the transcript into contiguous tool groups: one assistant tool-call
   * message followed by its run of `role: "tool"` results.
   */
  private findToolGroups(messages: readonly ModelMessage[]): ToolGroup[] {
    const groups: ToolGroup[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role !== 'assistant' || !message.toolCalls?.length) continue;

      let end = i + 1;
      while (end < messages.length && messages[end].role === 'tool') {
        end++;
      }

      groups.push({
        start: i,
        end,
        toolNames: message.toolCalls.map((c) => c.name),
        toolCallIds: message.toolCalls.map((c) => c.id),
      });
    }

    return groups;
  }

  /** A compact, deterministic description of the folded groups. */
  private summarize(groups: ToolGroup[]): string {
    const lines = groups.map((group, index) => {
      const tools = group.toolNames.join(', ');
      return `${index + 1}. ran ${group.toolCallIds.length} tool call(s): ${tools}`;
    });

    return (
      `[Earlier tool activity folded to bound context — ${groups.length} completed ` +
      `group(s). Full results remain in the durable transcript.]\n${lines.join('\n')}`
    );
  }
}
