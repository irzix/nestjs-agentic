import type { DocumentChunk } from '../interfaces/document.interface';
import type { KnowledgeGraphNode, KnowledgeGraphProvider } from '../interfaces/graph.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/** Type alias for a custom entity extractor function (e.g. NER model, LLM entity extraction). */
export type EntityExtractorFn = (query: string) => Promise<string[]> | string[];

/**
 * Options for configuring GraphRAGStrategy.
 */
export interface GraphRAGStrategyOptions {
  /** Knowledge Graph Provider implementation (e.g. InMemoryKnowledgeGraphProvider or Neo4j connector). */
  graphProvider: KnowledgeGraphProvider;

  /** Sub-graph traversal depth in number of relation hops. Default: `2` */
  maxDepth?: number;

  /** Score boost multiplier for candidate chunks that mention matched graph entities. Default: `1.25` */
  chunkScoreBoost?: number;

  /** Optional custom entity extractor function replacing the default token-based lookup. */
  extractEntitiesFn?: EntityExtractorFn;
}

/**
 * Post-retrieval RAG Strategy that traverses Knowledge Graph entity relationships,
 * boosts chunks containing graph entities, and injects structured relational context
 * into the RAG execution pipeline.
 */
export class GraphRAGStrategy implements RAGStrategy {
  readonly name = 'GraphRAG';
  readonly phase = 'post-retrieval' as const;
  private readonly graphProvider: KnowledgeGraphProvider;
  private readonly maxDepth: number;
  private readonly chunkScoreBoost: number;
  private readonly extractEntitiesFn?: EntityExtractorFn;

  /**
   * Creates a new instance of GraphRAGStrategy.
   * @param options Configuration for graph provider, traversal depth, score boost, and entity extractor.
   */
  constructor(options: GraphRAGStrategyOptions) {
    this.graphProvider = options.graphProvider;
    this.maxDepth = options.maxDepth ?? 2;
    this.chunkScoreBoost = options.chunkScoreBoost ?? 1.25;
    this.extractEntitiesFn = options.extractEntitiesFn;
  }

  /**
   * Traverses the Knowledge Graph for entities mentioned in the query, boosts matching chunk scores,
   * and injects structured relational facts into `graphContext` and `hydratedParentContext`.
   *
   * @param context RAGContext payload containing retrieved chunks and the original query.
   * @returns Promise resolving to updated RAGContext with `graphContext`, updated `scores`, and `hydratedParentContext`.
   */
  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.query) {
      return context;
    }

    const matchedNodesMap = new Map<string, KnowledgeGraphNode>();

    // 1. Extract or search entity nodes from query
    if (this.extractEntitiesFn) {
      const entityIds = await this.extractEntitiesFn(context.query);
      for (const id of entityIds) {
        matchedNodesMap.set(id, { id, label: id });
      }
    } else {
      const tokens = context.query
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 2);

      for (const token of tokens) {
        if (this.graphProvider.searchNodes) {
          const found = await this.graphProvider.searchNodes(token);
          for (const node of found) {
            matchedNodesMap.set(node.id, node);
          }
        } else {
          matchedNodesMap.set(token, { id: token, label: token });
        }
      }
    }

    if (matchedNodesMap.size === 0) {
      return context;
    }

    const graphFactLines = new Set<string>();
    const entityKeywords = new Set<string>();

    // 2. Traverse sub-graphs for identified entity nodes
    for (const rootNode of matchedNodesMap.values()) {
      entityKeywords.add(rootNode.id.toLowerCase());
      entityKeywords.add(rootNode.label.toLowerCase());

      try {
        const subGraph = await this.graphProvider.querySubGraph(rootNode.id, this.maxDepth);

        for (const node of subGraph.nodes) {
          entityKeywords.add(node.id.toLowerCase());
          entityKeywords.add(node.label.toLowerCase());
        }

        for (const edge of subGraph.edges) {
          const sourceNode = subGraph.nodes.find((n) => n.id === edge.sourceId);
          const targetNode = subGraph.nodes.find((n) => n.id === edge.targetId);

          const sourceLabel = sourceNode ? `${sourceNode.label} (${sourceNode.id})` : edge.sourceId;
          const targetLabel = targetNode ? `${targetNode.label} (${targetNode.id})` : edge.targetId;

          graphFactLines.add(`[Entity: ${sourceLabel}] -(${edge.relation})-> [Entity: ${targetLabel}]`);
        }
      } catch {
        // Continue gracefully if sub-graph lookup fails
      }
    }

    if (graphFactLines.size === 0) {
      return context;
    }

    const graphContextText = `### Knowledge Graph Relational Facts\n` + Array.from(graphFactLines).join('\n');

    // 3. Graph-Guided Candidate Chunk Score Boosting
    let updatedChunks = context.chunks;
    const scoresMap = new Map<string, number>(context.scores);

    if (context.chunks && context.chunks.length > 0) {
      updatedChunks = context.chunks.map((chunk) => {
        const contentLower = chunk.content.toLowerCase();
        let entityMatched = false;

        for (const kw of entityKeywords) {
          if (contentLower.includes(kw)) {
            entityMatched = true;
            break;
          }
        }

        if (entityMatched) {
          const currentScore = scoresMap.get(chunk.id) ?? 1.0;
          scoresMap.set(chunk.id, currentScore * this.chunkScoreBoost);
        }

        return chunk;
      });
    }

    // 4. Inject graph context into hydratedParentContext
    const updatedHydratedContext = context.hydratedParentContext
      ? `${graphContextText}\n---\n${context.hydratedParentContext}`
      : graphContextText;

    return {
      ...context,
      chunks: updatedChunks,
      scores: scoresMap,
      graphContext: graphContextText,
      hydratedParentContext: updatedHydratedContext,
    };
  }
}
