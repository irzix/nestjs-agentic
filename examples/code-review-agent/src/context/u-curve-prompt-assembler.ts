import { UCurveContextFormatter } from 'nestjs-agentic';
import { PromptInjectionSanitizer } from './prompt-injection-sanitizer';

/**
 * Options for assembling the prompt context with the Stanford U-Curve attention distribution.
 */
export interface UCurvePromptInput {
  systemInstructions: string;
  architecturalRules?: string[];
  astCodebaseContext?: string[];
  episodicLessons?: string[];
  prDiff: string;
  triggerComment?: string;
}

/**
 * Assembles multi-turn review prompts using the U-Shaped attention curve
 * to counter Lost-in-the-Middle attention degradation (Liu et al., Stanford/Berkeley).
 */
export class UCurvePromptAssembler {
  /**
   * Assembles a structured review prompt using UCurveContextFormatter buckets.
   *
   * @param input Context pieces to assemble.
   * @returns Formatted prompt text with optimal attention distribution.
   */
  static assemble(input: UCurvePromptInput): string {
    const rulesText = input.architecturalRules && input.architecturalRules.length > 0
      ? `## Architectural & Governance Rules:\n${input.architecturalRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

    const astText = input.astCodebaseContext && input.astCodebaseContext.length > 0
      ? `## Retrieved Codebase Context (AST):\n${input.astCodebaseContext.join('\n\n')}`
      : '';

    const lessonsText = input.episodicLessons && input.episodicLessons.length > 0
      ? `## Maintainer Lessons & False-Positive Prevention:\n${input.episodicLessons.map((l) => `- ${l}`).join('\n')}`
      : '';

    const diffWrapped = PromptInjectionSanitizer.wrapWithBoundary(
      'untrusted_pr_diff',
      input.prDiff,
    );

    const triggerWrapped = input.triggerComment
      ? PromptInjectionSanitizer.wrapWithBoundary('untrusted_user_trigger', input.triggerComment)
      : '';

    const recencyContent = [diffWrapped, triggerWrapped].filter(Boolean).join('\n\n');

    return UCurveContextFormatter.assemblePrompt([
      {
        priority: 'critical_primacy',
        content: `${input.systemInstructions}\n\n${rulesText}`.trim(),
      },
      {
        priority: 'high',
        content: astText,
      },
      {
        priority: 'medium_reference',
        content: lessonsText,
      },
      {
        priority: 'critical_recency',
        content: recencyContent,
      },
    ]);
  }
}
