import { PromptInjectionSanitizer } from '@nestjs-agentic/core';

import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/** Type alias for a custom context compressor function (e.g. LLM extractive summarizer). */
export type ContextCompressorFn = (query: string, rawText: string) => Promise<string> | string;

/**
 * Options for configuring ContextualCompressionStrategy.
 */
export interface ContextualCompressionStrategyOptions {
  /** Maximum allowable characters for the compressed context output. Default: `2000` */
  maxCharacters?: number;

  /** Filter out sentences that have no term overlap with the query tokens. Default: `true` */
  filterIrrelevantSentences?: boolean;

  /** Custom compression function (e.g. LLM sentence extractor or token compressor). */
  compressFn?: ContextCompressorFn;
}

/**
 * Post-retrieval RAG Strategy providing zero-latency extractive sentence pruning,
 * information density boosting, and smart sentence-boundary truncation.
 */
export class ContextualCompressionStrategy implements RAGStrategy {
  readonly name = 'ContextualCompression';
  readonly phase = 'post-retrieval' as const;
  private readonly maxCharacters: number;
  private readonly filterIrrelevantSentences: boolean;
  private readonly compressFn?: ContextCompressorFn;

  /**
   * Creates a new instance of ContextualCompressionStrategy.
   * @param options Configuration for character limits, sentence filtering, and optional compressor function.
   */
  constructor(options?: ContextualCompressionStrategyOptions) {
    this.maxCharacters = options?.maxCharacters ?? 2000;
    this.filterIrrelevantSentences = options?.filterIrrelevantSentences ?? true;
    this.compressFn = options?.compressFn;
  }

  /**
   * Compresses the retrieved context by extracting relevant sentences and applying smart truncation.
   *
   * @param context RAGContext payload containing retrieved chunks and the original query.
   * @returns Promise resolving to updated RAGContext with `compressedContext` field populated.
   */
  async process(context: RAGContext): Promise<RAGContext> {
    const rawContext =
      context.hydratedParentContext ||
      context.chunks?.map((c) => c.content).join('\n---\n') ||
      '';

    if (!rawContext.trim()) {
      return context;
    }

    // 1. Custom compressor function if supplied. Retrieved content is untrusted (it
    // may originate from ingested documents an attacker controls), so the final
    // output is wrapped in an explicit boundary tag to mitigate indirect prompt
    // injection before being spliced into the prompt.
    if (this.compressFn) {
      const customCompressed = await this.compressFn(context.query, rawContext);
      return {
        ...context,
        compressedContext: PromptInjectionSanitizer.wrapWithBoundary('retrieved_chunk', customCompressed),
      };
    }

    // 2. Extractive sentence-level relevance filtering (0ms latency, 0 token cost)
    let processedText = rawContext;
    if (this.filterIrrelevantSentences && context.query) {
      const queryTokens = new Set(
        context.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2),
      );

      if (queryTokens.size > 0) {
        const lines = rawContext.split(/(?<=[.!?\n])\s+/);
        const relevantLines = lines.filter((line) => {
          if (line.startsWith('#') || line.startsWith('--')) return true;
          const lower = line.toLowerCase();
          return Array.from(queryTokens).some((token) => lower.includes(token));
        });

        if (relevantLines.length > 0) {
          processedText = relevantLines.join('\n');
        }
      }
    }

    // 3. Sentence-aware smart truncation (truncates cleanly at sentence boundaries)
    if (processedText.length > this.maxCharacters) {
      const truncated = processedText.slice(0, this.maxCharacters);
      const lastSentenceEnd = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?'),
        truncated.lastIndexOf('\n'),
      );

      if (lastSentenceEnd > this.maxCharacters * 0.5) {
        processedText = truncated.slice(0, lastSentenceEnd + 1) + '\n[...Context Truncated...]';
      } else {
        processedText = truncated + '... [...Context Truncated...]';
      }
    }

    return {
      ...context,
      compressedContext: PromptInjectionSanitizer.wrapWithBoundary('retrieved_chunk', processedText),
    };
  }
}
