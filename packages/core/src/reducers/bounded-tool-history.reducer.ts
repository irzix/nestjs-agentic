import type {
  AgentMessageReducer,
  AgentMessageReductionContext,
} from '../interfaces/message-reducer.interface';
import type { ModelMessage } from '../interfaces/model.interface';

/** Options for {@link BoundedToolHistoryReducer}. */
export interface BoundedToolHistoryOptions {
  /**
   * Number of most-recent complete tool groups kept verbatim. Older groups are
   * each folded into a compact run-state message. Default: `1`.
   */
  keepLastToolGroups?: number;
  /**
   * Role used for a folded run-state summary. `user` is the safest default
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

/** Strips control characters, caps length, and quotes/escapes so a tool name cannot inject text. */
function safeToolName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const capped = cleaned.length > 64 ? `${cleaned.slice(0, 64)}…` : cleaned;
  // JSON.stringify quotes and escapes embedded quotes/backslashes.
  return JSON.stringify(capped);
}

/**
 * A deterministic, LLM-free context projector that bounds tool-loop growth.
 *
 * It keeps the last `keepLastToolGroups` complete tool groups verbatim and
 * folds every older completed group into a compact message describing what ran,
 * so intermediate observations are paid for once rather than re-sent on every
 * later round. Each folded group is replaced in place, so any system, user, or
 * plain assistant message between groups is always retained.
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

    const cutoff = groups.length - this.keepLast;

    // The set of group start indices that should be folded — every group older
    // than the retention window, except the active pending-approval group, which
    // resume needs verbatim.
    const foldStarts = new Map<number, ToolGroup>();
    for (let i = 0; i < cutoff; i++) {
      const group = groups[i];
      const isApprovalGroup =
        context.pendingApprovalToolCallId !== undefined &&
        group.toolCallIds.includes(context.pendingApprovalToolCallId);
      if (!isApprovalGroup) {
        foldStarts.set(group.start, group);
      }
    }

    if (foldStarts.size === 0) {
      return messages;
    }

    // Walk the transcript, replacing only folded group ranges with a summary and
    // emitting every other message — including anything between groups — verbatim.
    const result: ModelMessage[] = [];
    let i = 0;
    while (i < messages.length) {
      const folded = foldStarts.get(i);
      if (folded) {
        result.push({ role: this.summaryRole, content: this.summarize(folded) });
        i = folded.end;
        continue;
      }
      result.push(messages[i]);
      i++;
    }

    return result;
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

  /** A compact, deterministic description of one folded group. */
  private summarize(group: ToolGroup): string {
    const tools = group.toolNames.map(safeToolName).join(', ');
    return (
      `[Earlier tool activity folded to bound context. Full results remain in the durable ` +
      `transcript.] ran ${group.toolCallIds.length} tool call(s): ${tools}`
    );
  }
}
