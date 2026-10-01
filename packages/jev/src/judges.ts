import { assertTimeout, askJev, formatProbability } from './ask-jev';
import type { JevCallOptions, JevClient, JevState } from './jev.interface';

export interface JevJudgeOptions extends Omit<JevCallOptions, 'client'> {
  client: JevClient;
  /**
   * Ordered rubric, worst first, at least two levels. Jev places the input on
   * it and the expected position is normalized to a 0 to 1 score.
   */
  rubric?: readonly [string, string, ...string[]];
  /** Overrides the question Jev answers. */
  question?: string;
}

/** Shape of `FaithfulnessMetric`'s judge input in `@nestjs-agentic/evaluation`. */
export interface JevFaithfulnessInput {
  query: string;
  answer: string;
  contexts: string[];
  expectedAnswer?: string;
}

const FAITHFULNESS_RUBRIC = [
  'The answer is contradicted by the passages, or none of its claims are supported by them.',
  'Most claims are unsupported by the passages.',
  'About half of the claims are supported by the passages.',
  'Most claims are supported by the passages, with minor unsupported details.',
  'Every claim in the answer is supported by the passages.',
] as const;

const TASK_RUBRIC = [
  'The response fails the task or is wrong.',
  'The response attempts the task but is mostly wrong or unhelpful.',
  'The response partially accomplishes the task.',
  'The response accomplishes the task with minor issues.',
  'The response fully and correctly accomplishes the task.',
] as const;

async function scoreOnRubric(
  options: JevJudgeOptions,
  defaults: { question: string; rubric: readonly [string, string, ...string[]] },
  state: JevState,
): Promise<{ score: number; reason: string }> {
  const rubric = options.rubric ?? defaults.rubric;
  const { answers } = await askJev(
    options.client,
    state,
    { verdict: { type: 'score', instructions: options.question ?? defaults.question, criteria: rubric } },
    {
      model: options.model,
      timeoutMs: options.timeoutMs,
      circuitBreaker: options.circuitBreaker || undefined,
    },
  );
  const top = rubric.length - 1;
  const position = Math.min(top, Math.max(0, answers.verdict.score));
  // The score is what the metric needs; a missing confidence only shortens the reason.
  const confidence = answers.verdict.confidence;
  const confidenceNote =
    typeof confidence === 'number' && Number.isFinite(confidence) ? ` (confidence ${formatProbability(confidence)})` : '';
  return {
    score: position / top,
    reason: `Jev placed it at ${position.toFixed(2)} of ${top}${confidenceNote}.`,
  };
}

function assertJudgeOptions(options: JevJudgeOptions, owner: string): void {
  if (!options?.client) throw new Error(`${owner} needs a Jev client.`);
  assertTimeout(options.timeoutMs, owner);
}

/**
 * A faithfulness judge backed by Jev, for `FaithfulnessMetric` in
 * `@nestjs-agentic/evaluation`: Jev scores how well the answer is supported by
 * the retrieved passages on a five-level rubric.
 *
 * Jev sees the query, the answer, and the passages, not the item's
 * `expectedAnswer`: groundedness is about the passages, and a reference
 * answer would reward a correct answer the passages do not support.
 *
 * @example
 * new FaithfulnessMetric(jevFaithfulnessJudge({ client: new TypeSafeClient() }))
 */
export function jevFaithfulnessJudge(
  options: JevJudgeOptions,
): (input: JevFaithfulnessInput) => Promise<{ score: number; reason: string }> {
  assertJudgeOptions(options, 'jevFaithfulnessJudge');
  return (input) =>
    scoreOnRubric(
      options,
      {
        question: 'How well is the answer supported by the retrieved passages?',
        rubric: FAITHFULNESS_RUBRIC,
      },
      { question: input.query, answer: input.answer, passages: input.contexts },
    );
}

/**
 * A task-success judge backed by Jev, for `LLMAsAJudgeMetric` in
 * `@nestjs-agentic/evaluation`.
 *
 * @example
 * new LLMAsAJudgeMetric(jevTaskJudge({ client: new TypeSafeClient() }), 0.75)
 */
export function jevTaskJudge(
  options: JevJudgeOptions,
): (
  item: { query: string; expectedOutput?: string },
  result: { output: string },
) => Promise<{ score: number; reason: string }> {
  assertJudgeOptions(options, 'jevTaskJudge');
  return (item, result) =>
    scoreOnRubric(
      options,
      { question: 'How well does the response accomplish the task?', rubric: TASK_RUBRIC },
      {
        task: item.query,
        response: result.output,
        ...(item.expectedOutput !== undefined ? { expected: item.expectedOutput } : {}),
      },
    );
}
