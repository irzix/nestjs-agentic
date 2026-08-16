import type { KnowledgeGraphNode, KnowledgeGraphProvider } from '../interfaces/graph.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Options for configuring GraphDependencyStrategy.
 */
export interface GraphDependencyStrategyOptions {
  /** Knowledge Graph Provider implementation (e.g. InMemoryKnowledgeGraphProvider or Neo4j). */
  graphProvider: KnowledgeGraphProvider;

  /** Maximum dependency traversal depth in number of hops. Default: `3` */
  maxDepth?: number;

  /** Score boost multiplier for candidate chunks that belong to impacted dependencies. Default: `1.3` */
  dependencyScoreBoost?: number;

  /** Custom extractor for identifying package or symbol names from the query or changed files. */
  extractSymbolsFn?: (query: string) => Promise<string[]> | string[];
}

/**
 * RAG Strategy for traversing codebase package dependency graphs, import chains,
 * and cross-package impact trees in monorepos and modular systems.
 *
 * Resolves:
 * - Downstream dependents: "What packages/modules depend on component X?"
 * - Upstream dependencies: "What interfaces/services does component X implement/consume?"
 *
 * @see Lewis et al. (NeurIPS 2020, arXiv:2005.11401)
 * @see Microsoft GraphRAG (Edge et al., arXiv:2404.16130)
 */
export class GraphDependencyStrategy implements RAGStrategy {
  readonly name = 'GraphDependency';
  readonly phase = 'post-retrieval' as const;
  private readonly graphProvider: KnowledgeGraphProvider;
  private readonly maxDepth: number;
  private readonly dependencyScoreBoost: number;
  private readonly extractSymbolsFn?: (query: string) => Promise<string[]> | string[];

  constructor(options: GraphDependencyStrategyOptions) {
    this.graphProvider = options.graphProvider;
    this.maxDepth = options.maxDepth ?? 3;
    this.dependencyScoreBoost = options.dependencyScoreBoost ?? 1.3;
    this.extractSymbolsFn = options.extractSymbolsFn;
  }

  /**
   * Traverses the dependency graph for symbols/packages in the query,
   * generates impact trees, and enriches RAGContext with structured dependency facts.
   *
   * @param context RAGContext payload.
   * @returns Updated RAGContext with dependency graph facts and boosted chunk scores.
   */
  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.query || context.query.trim().length === 0) {
      return context;
    }

    const targetSymbols = await this.resolveTargetSymbols(context.query);
    if (targetSymbols.length === 0) {
      return context;
    }

    const dependencyFactLines = new Set<string>();
    const impactedEntities = new Set<string>();

    for (const symbol of targetSymbols) {
      impactedEntities.add(symbol.toLowerCase());

      try {
        const subGraph = await this.graphProvider.querySubGraph(symbol, this.maxDepth);

        for (const node of subGraph.nodes) {
          impactedEntities.add(node.id.toLowerCase());
          impactedEntities.add(node.label.toLowerCase());
        }

        for (const edge of subGraph.edges) {
          const source = subGraph.nodes.find((n) => n.id === edge.sourceId);
          const target = subGraph.nodes.find((n) => n.id === edge.targetId);

          const sourceLabel = source ? `${source.label} [${source.id}]` : edge.sourceId;
          const targetLabel = target ? `${target.label} [${target.id}]` : edge.targetId;

          dependencyFactLines.add(`• ${sourceLabel} --(${edge.relation})--> ${targetLabel}`);
        }
      } catch {
        // Fallback gracefully on graph retrieval errors
      }
    }

    if (dependencyFactLines.size === 0) {
      return context;
    }

    const dependencyContextText =
      `### Codebase Architecture & Dependency Graph Facts\n` +
      Array.from(dependencyFactLines).join('\n');

    // Boost candidate chunks that match impacted dependency entities
    let updatedChunks = context.chunks;
    const scoresMap = new Map<string, number>(context.scores);

    if (context.chunks && context.chunks.length > 0) {
      updatedChunks = context.chunks.map((chunk) => {
        const contentLower = chunk.content.toLowerCase();
        const filePath = (chunk.metadata.filePath as string)?.toLowerCase() ?? '';
        let matched = false;

        for (const entity of impactedEntities) {
          if (contentLower.includes(entity) || filePath.includes(entity)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          const currentScore = scoresMap.get(chunk.id) ?? 1.0;
          scoresMap.set(chunk.id, currentScore * this.dependencyScoreBoost);
        }

        return chunk;
      });
    }

    const updatedHydratedContext = context.hydratedParentContext
      ? `${dependencyContextText}\n---\n${context.hydratedParentContext}`
      : dependencyContextText;

    const existingFacts = context.relationalFacts ?? [];

    return {
      ...context,
      chunks: updatedChunks,
      scores: scoresMap,
      graphContext: context.graphContext
        ? `${context.graphContext}\n\n${dependencyContextText}`
        : dependencyContextText,
      hydratedParentContext: updatedHydratedContext,
      relationalFacts: [...existingFacts, ...Array.from(dependencyFactLines)],
    };
  }

  private async resolveTargetSymbols(query: string): Promise<string[]> {
    if (this.extractSymbolsFn) {
      return this.extractSymbolsFn(query);
    }

    const symbols: string[] = [];
    const tokens = query
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2);

    for (const token of tokens) {
      if (this.graphProvider.searchNodes) {
        const found = await this.graphProvider.searchNodes(token);
        for (const n of found) {
          symbols.push(n.id);
        }
      } else {
        symbols.push(token);
      }
    }

    return Array.from(new Set(symbols));
  }
}
