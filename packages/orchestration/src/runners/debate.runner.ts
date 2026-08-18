import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import type {
  DebateOptions,
  DebateRound,
  DebateRunResult,
  DebaterConfig,
  SubAgentResult,
  SubAgentTask,
} from '../interfaces/orchestration.interface';
import { ParallelSubAgentRunner } from './parallel-subagent.runner';

/**
 * Runner service implementing multi-round MIT-style Consensus Debate.
 *
 * Each round fans out to all debaters in parallel via `ParallelSubAgentRunner`.
 * After each round, the full transcript of arguments is injected as a prefix
 * into each debater's next-round prompt, enabling cross-critique and position refinement.
 * Convergence is measured via variance-based consensus scoring. The debate terminates
 * early when `consensusScore >= consensusThreshold`, or after `maxRounds`.
 *
 * @see Du et al., "Improving Factuality and Reasoning in LLMs through Multiagent Debate"
 *      (MIT CSAIL, arXiv:2305.14325)
 */
export class DebateRunner {
  private readonly options: {
    maxRounds: number;
    consensusThreshold: number;
    timeoutMs: number;
    retriesPerDebater: number;
    maxConcurrency?: number;
    signal?: AbortSignal;
    transcriptFormatterFn?: DebateOptions['transcriptFormatterFn'];
  };

  constructor(
    private readonly runner: AgentRunner,
    options?: DebateOptions,
  ) {
    this.options = {
      maxRounds: options?.maxRounds ?? 3,
      consensusThreshold: options?.consensusThreshold ?? 0.7,
      timeoutMs: options?.timeoutMs ?? 30000,
      retriesPerDebater: options?.retriesPerDebater ?? 1,
      maxConcurrency: options?.maxConcurrency,
      signal: options?.signal,
      transcriptFormatterFn: options?.transcriptFormatterFn,
    };
  }

  /**
   * Runs a multi-round consensus debate with the given debaters and initial prompt.
   *
   * @param parentContext - Parent agent context for tenant isolation and trace propagation.
   * @param debaters - Array of debater agent configurations.
   * @param initialMessage - The opening question or topic all debaters respond to in round 1.
   * @returns `DebateRunResult` containing all rounds, final winner, and convergence metadata.
   */
  async run(
    parentContext: AgentContext,
    debaters: DebaterConfig[],
    initialMessage: string,
  ): Promise<DebateRunResult> {
    if (debaters.length === 0) {
      return {
        finalResponse: '',
        winner: '',
        rounds: [],
        requiresHumanReview: false,
        terminationReason: 'consensus',
      };
    }

    if (this.options.signal?.aborted) {
      return this.abortedResult([]);
    }

    const rounds: DebateRound[] = [];
    let currentMessage = initialMessage;

    for (let roundNumber = 1; roundNumber <= this.options.maxRounds; roundNumber++) {
      if (this.options.signal?.aborted) {
        return this.abortedResult(rounds);
      }

      // Build per-debater tasks with transcript prefix for rounds > 1
      const tasks: SubAgentTask[] = debaters.map((d) => ({
        agentName: d.agentName,
        message: currentMessage,
        narrowing: d.narrowing,
        signal: this.options.signal,
      }));

      // Fan-out via ParallelSubAgentRunner with consensusMerge strategy
      const parallelRunner = new ParallelSubAgentRunner(this.runner, {
        aggregationStrategy: 'consensusMerge',
        timeoutMs: this.options.timeoutMs,
        retriesPerSubAgent: this.options.retriesPerDebater,
        maxConcurrency: this.options.maxConcurrency,
        signal: this.options.signal,
        consensusThreshold: this.options.consensusThreshold,
      });

      const fanOutResult = await parallelRunner.run(parentContext, tasks);

      const round: DebateRound = {
        roundNumber,
        results: fanOutResult.results,
        consensusScore: fanOutResult.consensusScore,
      };
      rounds.push(round);

      // Early termination on consensus
      if (
        fanOutResult.consensusScore !== undefined &&
        fanOutResult.consensusScore >= this.options.consensusThreshold
      ) {
        const winner = this.pickWinner(fanOutResult.results);
        return {
          finalResponse: winner.response,
          winner: winner.agentName,
          rounds,
          consensusScore: fanOutResult.consensusScore,
          requiresHumanReview: false,
          terminationReason: 'consensus',
        };
      }

      // Build cross-critique transcript for the next round
      if (roundNumber < this.options.maxRounds) {
        const transcript = this.buildTranscript(round);
        currentMessage = `${transcript}\n\n${initialMessage}`;
      }
    }

    // Max rounds reached without consensus — flag for human review
    const lastRound = rounds[rounds.length - 1];
    const winner = this.pickWinner(lastRound.results);
    return {
      finalResponse: winner.response,
      winner: winner.agentName,
      rounds,
      consensusScore: lastRound.consensusScore,
      requiresHumanReview: true,
      terminationReason: 'max_rounds',
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Selects the winner from a round's results: highest score, or first success.
   */
  private pickWinner(results: SubAgentResult[]): SubAgentResult {
    const successful = results.filter((r) => r.status === 'success');
    if (successful.length === 0) {
      return results[0] ?? { agentName: 'unknown', response: '', status: 'failed', toolCount: 0 };
    }
    return successful.reduce((best, r) => ((r.score ?? 0) > (best.score ?? 0) ? r : best));
  }

  /**
   * Builds the cross-critique transcript string prepended to the next round's prompt.
   * Uses a custom `transcriptFormatterFn` if provided, otherwise uses the default format.
   */
  private buildTranscript(round: DebateRound): string {
    if (this.options.transcriptFormatterFn) {
      return this.options.transcriptFormatterFn(round);
    }
    const lines = round.results
      .filter((r) => r.status === 'success')
      .map((r) => {
        const scoreNote = r.score !== undefined ? ` (confidence: ${r.score})` : '';
        return `[${r.agentName} argued${scoreNote}]: ${r.response}`;
      });
    return `--- Round ${round.roundNumber} Arguments ---\n${lines.join('\n\n')}\n--- End of Round ${round.roundNumber} ---`;
  }

  /**
   * Builds a uniform aborted `DebateRunResult`.
   */
  private abortedResult(rounds: DebateRound[]): DebateRunResult {
    return {
      finalResponse: '',
      winner: '',
      rounds,
      requiresHumanReview: false,
      terminationReason: 'aborted',
    };
  }
}
