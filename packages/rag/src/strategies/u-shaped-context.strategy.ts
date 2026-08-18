import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Strategy mode determining whether the #1 ranked chunk is positioned at the top (Primacy) or bottom (Recency).
 */
export type UShapePlacementStrategy = 'primacy_first' | 'recency_first';

/**
 * Configuration options for UShapedContextStrategy.
 */
export interface UShapedContextStrategyOptions {
  /**
   * Determines placement order of highest-ranked chunks.
   * - `'primacy_first'` (default): Places #1 chunk at top (Primacy) and #2 at bottom (Recency): `[c1, c3, ..., c4, c2]`.
   * - `'recency_first'`: Places #1 chunk at bottom (Recency) and #2 at top (Primacy): `[c2, c4, ..., c3, c1]`.
   */
  placementStrategy?: UShapePlacementStrategy;

  /** Maximum number of chunks to retain in the U-shaped context. Default: unlimited */
  maxChunks?: number;

  /** Optional header string prepended to the formatted context string */
  header?: string;

  /** Optional footer string appended to the formatted context string */
  footer?: string;

  /** Separator used between chunks when joining formatted text. Default: `'\n\n---\n\n'` */
  chunkSeparator?: string;
}

/**
 * Post-retrieval RAG Strategy implementing U-Shaped Attention Distribution
 * to mitigate "Lost in the Middle" retrieval and reasoning degradation.
 *
 * Places top-relevance documents at the extreme beginning (Primacy) and extreme end (Recency)
 * of the context window while relegating lower-relevance documents to the middle valley.
 *
 * @see Liu et al., "Lost in the Middle: How Language Models Use Long Contexts" (Stanford University & UC Berkeley, TACL 2024, arXiv:2307.03172)
 */
export class UShapedContextStrategy implements RAGStrategy {
  readonly name = 'UShapedContext';
  readonly phase = 'post-retrieval' as const;

  private readonly placementStrategy: UShapePlacementStrategy;
  private readonly maxChunks?: number;
  private readonly header?: string;
  private readonly footer?: string;
  private readonly chunkSeparator: string;

  /**
   * Creates a new instance of UShapedContextStrategy.
   * @param options Configuration options for placement, chunk limits, and formatting.
   */
  constructor(options?: UShapedContextStrategyOptions) {
    this.placementStrategy = options?.placementStrategy ?? 'primacy_first';
    this.maxChunks = options?.maxChunks;
    this.header = options?.header;
    this.footer = options?.footer;
    this.chunkSeparator = options?.chunkSeparator ?? '\n\n---\n\n';
  }

  /**
   * Reorders an array of ranked items into the optimal U-shaped attention distribution.
   *
   * @param rankedItems Array of items pre-sorted in descending order of relevance.
   * @param strategy Placement mode ('primacy_first' or 'recency_first'). Defaults to 'primacy_first'.
   * @returns Reordered array with highest relevance items at the edges and lowest in the center.
   */
  static reorder<T>(
    rankedItems: T[],
    strategy: UShapePlacementStrategy = 'primacy_first',
  ): T[] {
    if (!rankedItems || rankedItems.length <= 2) {
      return rankedItems ? [...rankedItems] : [];
    }

    const n = rankedItems.length;
    const result: T[] = new Array(n);

    let left = 0;
    let right = n - 1;

    if (strategy === 'primacy_first') {
      // Primacy-first: c1 at index 0, c2 at index n-1, c3 at index 1, c4 at index n-2, ...
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          result[left] = rankedItems[i];
          left++;
        } else {
          result[right] = rankedItems[i];
          right--;
        }
      }
    } else {
      // Recency-first: c1 at index n-1, c2 at index 0, c3 at index n-2, c4 at index 1, ...
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          result[right] = rankedItems[i];
          right--;
        } else {
          result[left] = rankedItems[i];
          left++;
        }
      }
    }

    return result;
  }

  /**
   * Processes the RAGContext by reordering retrieved chunks into a U-shaped distribution
   * and generating the structured `compressedContext` prompt text.
   *
   * @param context Mutable RAGContext payload.
   * @returns Updated RAGContext with U-ordered chunks and formatted context.
   */
  process(context: RAGContext): RAGContext {
    let chunks = context.chunks ?? [];

    if (chunks.length === 0) {
      return context;
    }

    // Sort chunks by score if score map is provided and chunks are not pre-sorted
    if (context.scores && context.scores.size > 0) {
      chunks = [...chunks].sort((a, b) => {
        const scoreA = context.scores?.get(a.id) ?? 0;
        const scoreB = context.scores?.get(b.id) ?? 0;
        return scoreB - scoreA;
      });
    }

    // Apply maxChunks limit if configured
    if (this.maxChunks && this.maxChunks > 0 && chunks.length > this.maxChunks) {
      chunks = chunks.slice(0, this.maxChunks);
    }

    // Reorder chunks into U-curve distribution
    const uOrderedChunks = UShapedContextStrategy.reorder<DocumentChunk>(
      chunks,
      this.placementStrategy,
    );

    // Format chunk text
    const formattedChunks = uOrderedChunks.map((chunk, idx) => {
      const title = (chunk.metadata?.title as string) ?? (chunk.metadata?.section as string) ?? `Chunk ${idx + 1}`;
      return `[Reference: ${title}]\n${chunk.content}`;
    });

    const parts: string[] = [];
    if (this.header) {
      parts.push(this.header);
    }
    parts.push(formattedChunks.join(this.chunkSeparator));
    if (this.footer) {
      parts.push(this.footer);
    }

    const compressedContext = parts.join('\n\n');

    return {
      ...context,
      chunks: uOrderedChunks,
      compressedContext,
      metadata: {
        ...context.metadata,
        uShapeApplied: true,
        uShapeStrategy: this.placementStrategy,
        chunkCount: uOrderedChunks.length,
      },
    };
  }
}
