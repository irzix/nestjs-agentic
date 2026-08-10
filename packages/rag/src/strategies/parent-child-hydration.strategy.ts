import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Interface for a parent chunk store provider.
 * Used to hydrate child chunks back to their larger parent context sections.
 */
export interface ParentStoreProvider {
  /**
   * Fetches a parent DocumentChunk by its unique parentId.
   * @param parentId The unique identifier of the parent chunk.
   * @returns The parent DocumentChunk or undefined if not found.
   */
  getParentChunk(parentId: string): Promise<DocumentChunk | undefined> | DocumentChunk | undefined;
}

/**
 * Options for configuring ParentChildHydrationStrategy.
 */
export interface ParentChildHydrationStrategyOptions {
  /** Optional ParentStore provider for fetching parent chunks by parentId. */
  parentStore?: ParentStoreProvider;

  /** Whether to replace each child chunk's content with its parent context content in `context.chunks`. Default: `true` */
  replaceChunkContent?: boolean;
}

/**
 * Post-retrieval RAG Strategy that resolves small child vector chunks back to their larger parent
 * context sections, maximizing LLM context richness by replacing narrow child text with full section content.
 */
export class ParentChildHydrationStrategy implements RAGStrategy {
  readonly name = 'ParentChildHydration';
  readonly phase = 'post-retrieval' as const;
  private readonly parentStore?: ParentStoreProvider;
  private readonly replaceChunkContent: boolean;

  /**
   * Creates a new instance of ParentChildHydrationStrategy.
   * @param options Configuration for parent store and chunk content replacement behavior.
   */
  constructor(options?: ParentChildHydrationStrategyOptions) {
    this.parentStore = options?.parentStore;
    this.replaceChunkContent = options?.replaceChunkContent ?? true;
  }

  /**
   * Resolves each child chunk to its parent text, optionally replacing chunk content with the parent context.
   * Combines all hydrated parent texts into a unified `hydratedParentContext` string.
   *
   * @param context RAGContext payload containing retrieved child chunks.
   * @returns Promise resolving to updated RAGContext with hydrated chunks and `hydratedParentContext` populated.
   */
  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.chunks || context.chunks.length === 0) {
      return context;
    }

    const hydratedParentsMap = new Map<string, string>();
    const updatedChunks: DocumentChunk[] = [];

    for (const chunk of context.chunks) {
      let parentText: string | undefined;

      // 1. Try resolving from parentStore if parentId exists
      if (chunk.parentId && this.parentStore) {
        const parentChunk = await this.parentStore.getParentChunk(chunk.parentId);
        if (parentChunk) {
          parentText = parentChunk.content;
        }
      }

      // 2. Fallback to metadata.parentText or chunk content
      if (!parentText) {
        parentText = (chunk.metadata?.parentText as string) ?? chunk.content;
      }

      hydratedParentsMap.set(chunk.parentId || chunk.id, parentText);

      updatedChunks.push({
        ...chunk,
        content: this.replaceChunkContent ? parentText : chunk.content,
        metadata: {
          ...chunk.metadata,
          originalChildContent: chunk.content,
          parentHydrated: true,
        },
      });
    }

    const combinedParentContext = Array.from(hydratedParentsMap.values()).join('\n---\n');

    return {
      ...context,
      chunks: updatedChunks,
      hydratedParentContext: combinedParentContext,
    };
  }
}
