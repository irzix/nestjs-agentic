import type {
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  KnowledgeGraphProvider,
} from '../interfaces/graph.interface';
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
 * Production-grade RAG Strategy for traversing codebase package dependency graphs,
 * import chains, and cross-package impact trees in monorepos and modular systems.
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

  // Token boundary regex patterns
  private static readonly RE_SCOPED_PACKAGE = /@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g;
  private static readonly RE_IDENTIFIERS = /\b[A-Za-z_$][A-Za-z0-9_$.-]{2,}\b/g;
  private static readonly STOP_WORDS = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'what',
    'which',
    'impact',
    'analysis',
    'query',
    'test',
    'code',
    'file',
  ]);

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
    if (!context || !context.query || context.query.trim().length === 0) {
      return context;
    }

    const targetSymbols = await this.resolveTargetSymbols(context.query);
    if (targetSymbols.length === 0) {
      return context;
    }

    const dependencyFactLines = new Set<string>();
    const impactedEntities = new Set<string>();
    const visitedSymbols = new Set<string>();
    const seenEdges = new Set<string>();

    for (const symbol of targetSymbols) {
      impactedEntities.add(symbol.toLowerCase());
      await this.traverseWithCycleProtection(
        symbol,
        0,
        visitedSymbols,
        seenEdges,
        impactedEntities,
        dependencyFactLines,
      );
    }

    if (dependencyFactLines.size === 0) {
      return context;
    }

    const dependencyContextText =
      `### Codebase Architecture & Dependency Graph Facts\n` +
      Array.from(dependencyFactLines).join('\n');

    // Convert scores safely regardless of input type (Map, Record, or undefined)
    const scoresMap = new Map<string, number>();
    if (context.scores instanceof Map) {
      for (const [k, v] of context.scores.entries()) {
        scoresMap.set(k, v);
      }
    } else if (context.scores && typeof context.scores === 'object') {
      for (const [k, v] of Object.entries(context.scores)) {
        scoresMap.set(k, Number(v));
      }
    }

    let updatedChunks = context.chunks;
    if (context.chunks && context.chunks.length > 0) {
      updatedChunks = context.chunks.map((chunk) => {
        const content = typeof chunk.content === 'string' ? chunk.content : '';
        const filePath = typeof chunk.metadata?.filePath === 'string' ? chunk.metadata.filePath : '';
        const combinedText = `${content}\n${filePath}`.toLowerCase();

        let matched = false;
        for (const entity of impactedEntities) {
          if (entity.length < 3 || GraphDependencyStrategy.STOP_WORDS.has(entity)) continue;

          // Exact word/token boundary matching
          const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`, 'i');

          if (wordRegex.test(combinedText)) {
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

  private async traverseWithCycleProtection(
    currentSymbol: string,
    currentDepth: number,
    visitedSymbols: Set<string>,
    seenEdges: Set<string>,
    impactedEntities: Set<string>,
    factLines: Set<string>,
  ): Promise<void> {
    if (visitedSymbols.has(currentSymbol) || currentDepth > this.maxDepth) {
      return;
    }
    visitedSymbols.add(currentSymbol);

    try {
      const subGraph = await this.graphProvider.querySubGraph(currentSymbol, 1);

      for (const node of subGraph.nodes) {
        impactedEntities.add(node.id.toLowerCase());
        impactedEntities.add(node.label.toLowerCase());
      }

      for (const edge of subGraph.edges) {
        const edgeKey = `${edge.sourceId}->${edge.relation}->${edge.targetId}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const source = subGraph.nodes.find((n: KnowledgeGraphNode) => n.id === edge.sourceId);
        const target = subGraph.nodes.find((n: KnowledgeGraphNode) => n.id === edge.targetId);

        const sourceLabel = source ? `${source.label} [${source.id}]` : edge.sourceId;
        const targetLabel = target ? `${target.label} [${target.id}]` : edge.targetId;

        factLines.add(`• ${sourceLabel} --(${edge.relation})--> ${targetLabel}`);

        // Recursively traverse connected neighbor
        const nextSymbol = edge.sourceId === currentSymbol ? edge.targetId : edge.sourceId;
        if (!visitedSymbols.has(nextSymbol)) {
          await this.traverseWithCycleProtection(
            nextSymbol,
            currentDepth + 1,
            visitedSymbols,
            seenEdges,
            impactedEntities,
            factLines,
          );
        }
      }
    } catch (err: unknown) {
      if (process.env.RAG_LOG_DEBUG === 'true') {
        console.debug(`[GraphDependencyStrategy] Traversal error for: ${currentSymbol}`, err);
      }
    }
  }

  private async resolveTargetSymbols(query: string): Promise<string[]> {
    if (this.extractSymbolsFn) {
      return this.extractSymbolsFn(query);
    }

    const symbols = new Set<string>();

    // 1. Match scoped package names (e.g., @nestjs-agentic/core)
    const scopedMatches = query.match(GraphDependencyStrategy.RE_SCOPED_PACKAGE) ?? [];
    for (const match of scopedMatches) {
      symbols.add(match);
    }

    // 2. Match individual identifier symbols
    const identifierMatches = query.match(GraphDependencyStrategy.RE_IDENTIFIERS) ?? [];
    for (const match of identifierMatches) {
      if (!match.startsWith('@') && !GraphDependencyStrategy.STOP_WORDS.has(match.toLowerCase())) {
        symbols.add(match);
      }
    }

    // 3. Supplement with graph node search
    if (this.graphProvider.searchNodes) {
      for (const sym of Array.from(symbols)) {
        try {
          const found = await this.graphProvider.searchNodes(sym);
          for (const n of found) {
            symbols.add(n.id);
          }
        } catch (err: unknown) {
          if (process.env.RAG_LOG_DEBUG === 'true') {
            console.debug(`[GraphDependencyStrategy] searchNodes error for: ${sym}`, err);
          }
        }
      }
    }

    return Array.from(symbols);
  }
}
