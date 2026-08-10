import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Hierarchical tree node representing a document section in the RAG structured output.
 */
export interface HierarchicalNode {
  /** Unique node identifier. */
  id: string;
  /** Section title label. */
  title: string;
  /** Heading depth level (1 = top-level section, 2 = child chunk). */
  level: number;
  /** Optional section text content. */
  content?: string;
  /** Child nodes representing individual document chunks under this section. */
  children: HierarchicalNode[];
  [key: string]: unknown;
}

/**
 * Options for configuring HierarchicalRAGStrategy.
 */
export interface HierarchicalRAGStrategyOptions {
  /** Group retrieved chunks under their parent document/section header. Default: `true` */
  groupByHeader?: boolean;

  /** Merge sibling chunks belonging to the same section into a single unified section text. Default: `true` */
  rollupSiblings?: boolean;
}

/**
 * Post-retrieval RAG Strategy that organizes, groups, and rolls up retrieved chunks
 * into a structured hierarchical tree (Document → Section → Paragraph) for structured LLM reasoning.
 */
export class HierarchicalRAGStrategy implements RAGStrategy {
  readonly name = 'HierarchicalRAG';
  readonly phase = 'post-retrieval' as const;
  private readonly groupByHeader: boolean;
  private readonly rollupSiblings: boolean;

  /**
   * Creates a new instance of HierarchicalRAGStrategy.
   * @param options Configuration for header grouping and sibling rollup behavior.
   */
  constructor(options?: HierarchicalRAGStrategyOptions) {
    this.groupByHeader = options?.groupByHeader ?? true;
    this.rollupSiblings = options?.rollupSiblings ?? true;
  }

  /**
   * Groups retrieved chunks by section header and optionally merges siblings into unified context blocks.
   *
   * @param context RAGContext payload containing retrieved chunks with section metadata.
   * @returns Promise resolving to updated RAGContext with `chunks` restructured and `hierarchicalTree` populated.
   */
  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.chunks || context.chunks.length === 0) {
      return context;
    }

    const sectionGroupMap = new Map<string, DocumentChunk[]>();

    for (const chunk of context.chunks) {
      const sectionTitle =
        (chunk.metadata?.documentTitle as string) || (chunk.metadata?.sectionTitle as string) || 'General Context';
      const existing = sectionGroupMap.get(sectionTitle) || [];
      existing.push(chunk);
      sectionGroupMap.set(sectionTitle, existing);
    }

    const structuredChunks: DocumentChunk[] = [];
    const treeNodes: HierarchicalNode[] = [];

    for (const [title, chunks] of sectionGroupMap.entries()) {
      chunks.sort((a, b) => {
        const idxA = (a.metadata?.chunkIndex as number) ?? (a.metadata?.parentIndex as number) ?? 0;
        const idxB = (b.metadata?.chunkIndex as number) ?? (b.metadata?.parentIndex as number) ?? 0;
        return idxA - idxB;
      });

      const sectionContent = this.rollupSiblings
        ? chunks.map((c) => c.content).join('\n')
        : chunks[0].content;

      const formattedContent = this.groupByHeader
        ? `## Section: ${title}\n${sectionContent}`
        : sectionContent;

      structuredChunks.push({
        ...chunks[0],
        content: formattedContent,
        metadata: {
          ...chunks[0].metadata,
          hierarchicalRollup: true,
          totalSiblingChunksMerged: chunks.length,
        },
      });

      treeNodes.push({
        id: `node_${title.replace(/\s+/g, '_')}`,
        title,
        level: 1,
        content: sectionContent,
        children: chunks.map((c) => ({
          id: c.id,
          title: `Chunk ${c.id}`,
          level: 2,
          content: c.content,
          children: [],
        })),
      });
    }

    return {
      ...context,
      chunks: structuredChunks,
      hierarchicalTree: treeNodes,
    };
  }
}
