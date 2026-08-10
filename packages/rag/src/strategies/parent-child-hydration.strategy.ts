import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

export interface ParentStoreProvider {
  getParentChunk(parentId: string): Promise<DocumentChunk | undefined> | DocumentChunk | undefined;
}

export interface ParentChildHydrationStrategyOptions {
  /** Optional ParentStore provider for fetching parent chunks by parentId. */
  parentStore?: ParentStoreProvider;
  /** Whether to replace each child chunk's content with its parent content in context.chunks. Default: true */
  replaceChunkContent?: boolean;
}

/**
 * Strategy that resolves small child vector chunks back to their larger parent context sections for maximum LLM context richness.
 */
export class ParentChildHydrationStrategy implements RAGStrategy {
  readonly name = 'ParentChildHydration';
  private readonly parentStore?: ParentStoreProvider;
  private readonly replaceChunkContent: boolean;

  constructor(options?: ParentChildHydrationStrategyOptions) {
    this.parentStore = options?.parentStore;
    this.replaceChunkContent = options?.replaceChunkContent ?? true;
  }

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
