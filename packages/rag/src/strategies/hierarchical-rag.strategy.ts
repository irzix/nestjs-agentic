import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

export interface HierarchicalNode {
  id: string;
  title: string;
  level: number;
  content?: string;
  children: HierarchicalNode[];
  [key: string]: unknown;
}

export interface HierarchicalRAGStrategyOptions {
  /** Group retrieved chunks under their parent document/section header. Default: true */
  groupByHeader?: boolean;
  /** Merge sibling chunks belonging to the same section into a single unified section text. Default: true */
  rollupSiblings?: boolean;
}

/**
 * Hierarchical RAG Strategy: Organizes, groups, and rolls up retrieved chunks into a structured hierarchical tree
 * (Document -> Section -> Paragraph) for structural LLM reasoning.
 */
export class HierarchicalRAGStrategy implements RAGStrategy {
  readonly name = 'HierarchicalRAG';
  private readonly groupByHeader: boolean;
  private readonly rollupSiblings: boolean;

  constructor(options?: HierarchicalRAGStrategyOptions) {
    this.groupByHeader = options?.groupByHeader ?? true;
    this.rollupSiblings = options?.rollupSiblings ?? true;
  }

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
