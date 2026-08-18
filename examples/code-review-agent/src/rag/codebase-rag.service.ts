import { Injectable, Inject } from '@nestjs/common';
import {
  AstCodebaseSplitter,
  GraphDependencyStrategy,
  HybridVectorStore,
  InMemoryKnowledgeGraphProvider,
  KnowledgeBase,
  ParentChildHydrationStrategy,
  QueryExpansionStrategy,
  RAGPipeline,
  UShapedContextStrategy,
} from '@nestjs-agentic/rag';
import type { Document, DocumentChunk, EmbeddingProvider } from '@nestjs-agentic/rag';
import { EMBEDDING_PROVIDER } from './embedding.tokens';

/**
 * Service managing AST codebase indexing, GraphRAG dependency tracing,
 * and hybrid vector retrieval for Njent code reviews.
 */
@Injectable()
export class CodebaseRAGService {
  private readonly knowledgeBase: KnowledgeBase;
  private readonly pipeline: RAGPipeline;
  private readonly astSplitter: AstCodebaseSplitter;
  private readonly graphProvider: InMemoryKnowledgeGraphProvider;

  /**
   * @param embeddingProvider Injected embedding provider (real or mock).
   *   When `OPENROUTER_API_KEY` is set, resolves to `OpenAIEmbeddingAdapter`
   *   targeting `perplexity/pplx-embed-v1-0.6b` via OpenRouter.
   *   Falls back to `MockEmbeddingProvider` in local / CI environments.
   */
  constructor(@Inject(EMBEDDING_PROVIDER) embeddingProvider: EmbeddingProvider) {
    this.astSplitter = new AstCodebaseSplitter({
      maxChunkSize: 1500,
      splitClassMethods: true,
    });

    // HybridVectorStore uses the injected embedding provider for cosine-similarity
    // dense retrieval backed by the real (or mock) embedding model.
    const vectorStore = new HybridVectorStore({ embeddingProvider });

    this.knowledgeBase = new KnowledgeBase({
      splitter: this.astSplitter,
      vectorStore,
    });

    this.graphProvider = new InMemoryKnowledgeGraphProvider();

    this.pipeline = new RAGPipeline({
      knowledgeBase: this.knowledgeBase,
    });

    // 1. Query Expansion (Domain synonyms for NestJS and agentic patterns)
    this.pipeline.addStrategy(
      new QueryExpansionStrategy({
        synonymsMap: {
          governance: ['policy', 'guard', 'approval', 'checkpoint'],
          memory: ['session', 'episodic', 'sop', 'stanford'],
          rag: ['graph', 'ast', 'vector', 'splitter'],
          review: ['security', 'architecture', 'quality', 'lint'],
        },
      }),
    );

    // 2. Parent-Child Class Hydration
    this.pipeline.addStrategy(new ParentChildHydrationStrategy());

    // 3. Graph Dependency Strategy (tracing cross-package import relationships)
    this.pipeline.addStrategy(new GraphDependencyStrategy({ graphProvider: this.graphProvider }));

    // 4. U-Shaped Attention Strategy
    this.pipeline.addStrategy(new UShapedContextStrategy({ maxChunks: 6 }));
  }

  /**
   * Ingests and indexes an array of codebase source files.
   *
   * @param files Raw codebase files with paths and code contents.
   */
  async ingestCodebase(files: Array<{ filePath: string; content: string }>): Promise<number> {
    let totalChunks = 0;

    for (const file of files) {
      const doc = await this.knowledgeBase.ingestDocument({
        id: file.filePath,
        title: file.filePath,
        rawContent: file.content,
        metadata: { filePath: file.filePath, language: 'typescript' },
      });

      totalChunks += doc.chunks.length;

      // Extract import relations into the Knowledge Graph
      const importMatches = Array.from(
        file.content.matchAll(/import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g),
      );

      for (const match of importMatches) {
        const symbols = (match[1] || match[2] || '')
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean);

        for (const sym of symbols) {
          for (const chunk of doc.chunks) {
            const ident = chunk.metadata?.identifier;
            if (ident && ident !== sym) {
              await this.graphProvider.addEdge({
                sourceId: String(ident),
                targetId: sym,
                relation: 'DEPENDS_ON',
              });
            }
          }
        }
      }
    }

    return totalChunks;
  }

  /**
   * Retrieves relevant AST chunks and dependency facts for a code review query or modified file.
   *
   * @param query Contextual query or symbol name.
   * @returns Array of retrieved context snippets formatted for prompt insertion.
   */
  async retrieveContext(query: string): Promise<string[]> {
    const context = await this.pipeline.executePipeline(query, 5);
    return (context.chunks || []).map((c: DocumentChunk) => {
      const symbol = c.metadata?.identifier ? ` [Symbol: ${c.metadata.identifier}]` : '';
      const file = c.metadata?.filePath ? ` [File: ${c.metadata.filePath}]` : '';
      return `/* --- Codebase Reference${symbol}${file} --- */\n${c.content}`;
    });
  }

  /**
   * Returns the underlying KnowledgeBase instance.
   */
  getKnowledgeBase(): KnowledgeBase {
    return this.knowledgeBase;
  }

  /**
   * Returns the underlying KnowledgeGraph instance.
   */
  getGraphProvider(): InMemoryKnowledgeGraphProvider {
    return this.graphProvider;
  }
}
