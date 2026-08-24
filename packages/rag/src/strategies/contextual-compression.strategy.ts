import { PromptInjectionSanitizer } from '@nestjs-agentic/core';

import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/** Type alias for a custom context compressor function (e.g. LLM extractive summarizer). */
export type ContextCompressorFn = (query: string, rawText: string) => Promise<string> | string;

/**
 * Options for configuring ContextualCompressionStrategy.
 */
export interface ContextualCompressionStrategyOptions {
  /**
   * Maximum allowable characters per compressed source. Applied per retrieved chunk
   * (and to a hydrated parent context as a single source). Default: `2000`
   */
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
    const hydrated = context.hydratedParentContext?.trim();
    const chunks = context.chunks ?? [];

    // A custom compressor collapses all sources into one blob, so it is a single
    // logical unit and gets one boundary. Retrieved content is untrusted, so the
    // output is sanitized and boundary-wrapped to mitigate indirect prompt injection.
    if (this.compressFn) {
      const rawContext = hydrated || chunks.map((c) => c.content).join('\n---\n');
      if (!rawContext.trim()) {
        return context;
      }
      const customCompressed = await this.compressFn(context.query, rawContext);
      return {
        ...context,
        compressedContext: PromptInjectionSanitizer.wrapWithBoundary('retrieved_chunk', customCompressed),
      };
    }

    // A hydrated parent context represents a single source -> a single boundary.
    if (hydrated) {
      return {
        ...context,
        compressedContext: this.compressAndWrap(hydrated, context.query),
      };
    }

    if (chunks.length === 0) {
      return context;
    }

    // Multiple retrieved chunks -> one boundary per source chunk, so a delimiter in
    // one chunk can never blend into another chunk's content in the assembled prompt.
    const compressedContext = chunks
      .map((c) => this.compressAndWrap(c.content, context.query))
      .join('\n---\n');

    return {
      ...context,
      compressedContext,
    };
  }

  /**
   * Applies extractive relevance filtering and smart truncation to a single source's
   * text, then sanitizes and wraps it in a `<retrieved_chunk>` boundary.
   */
  private compressAndWrap(rawText: string, query: string): string {
    const filtered = this.filterRelevantSentences(rawText, query);
    const truncated = this.truncate(filtered);
    return PromptInjectionSanitizer.wrapWithBoundary('retrieved_chunk', truncated);
  }

  /** Extractive sentence-level relevance filtering (0ms latency, 0 token cost). */
  private filterRelevantSentences(rawText: string, query: string): string {
    if (!this.filterIrrelevantSentences || !query) {
      return rawText;
    }

    const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
    if (queryTokens.size === 0) {
      return rawText;
    }

    const lines = rawText.split(/(?<=[.!?\n])\s+/);
    const relevantLines = lines.filter((line) => {
      if (line.startsWith('#') || line.startsWith('--')) return true;
      const lower = line.toLowerCase();
      return Array.from(queryTokens).some((token) => lower.includes(token));
    });

    return relevantLines.length > 0 ? relevantLines.join('\n') : rawText;
  }

  /** Sentence-aware smart truncation that cuts cleanly at sentence boundaries. */
  private truncate(text: string): string {
    if (text.length <= this.maxCharacters) {
      return text;
    }

    const truncated = text.slice(0, this.maxCharacters);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?'),
      truncated.lastIndexOf('\n'),
    );

    if (lastSentenceEnd > this.maxCharacters * 0.5) {
      return truncated.slice(0, lastSentenceEnd + 1) + '\n[...Context Truncated...]';
    }
    return truncated + '... [...Context Truncated...]';
  }
}
