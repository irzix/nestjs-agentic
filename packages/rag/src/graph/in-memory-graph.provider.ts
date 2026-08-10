import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphProvider,
} from '../interfaces/graph.interface';

/**
 * Built-in In-Memory Knowledge Graph Provider for tracking entity relationships in RAG workflows.
 * Supports BFS-based sub-graph traversal, keyword node search, and relationship edge management.
 */
export class InMemoryKnowledgeGraphProvider implements KnowledgeGraphProvider {
  private readonly nodes = new Map<string, KnowledgeGraphNode>();
  private readonly edges: KnowledgeGraphEdge[] = [];

  /**
   * Adds or updates a knowledge graph node by its unique ID.
   *
   * @param node The KnowledgeGraphNode object to add or update.
   */
  async addNode(node: KnowledgeGraphNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  /**
   * Adds a directed relationship edge between two knowledge graph nodes.
   *
   * @param edge The KnowledgeGraphEdge object defining source, target, and relation type.
   */
  async addEdge(edge: KnowledgeGraphEdge): Promise<void> {
    this.edges.push(edge);
  }

  /**
   * Searches graph nodes by keyword matching against node ID, label, and properties.
   *
   * @param keyword Search keyword string.
   * @returns Promise resolving to an array of matching KnowledgeGraphNode objects.
   */
  async searchNodes(keyword: string): Promise<KnowledgeGraphNode[]> {
    if (!keyword.trim()) return [];
    const lower = keyword.toLowerCase();

    const matches: KnowledgeGraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.id.toLowerCase().includes(lower) || node.label.toLowerCase().includes(lower)) {
        matches.push(node);
        continue;
      }

      if (node.properties) {
        const propString = JSON.stringify(node.properties).toLowerCase();
        if (propString.includes(lower)) {
          matches.push(node);
        }
      }
    }

    return matches;
  }

  /**
   * Traverses the knowledge graph using BFS from a root entity node up to the specified depth,
   * returning all reachable nodes and their connecting edges.
   *
   * @param entityId Root entity node identifier to start traversal from.
   * @param depth Maximum traversal depth in relation hops. Default: `2`
   * @returns Promise resolving to an object containing matched `nodes` and `edges` arrays.
   */
  async querySubGraph(
    entityId: string,
    depth = 2,
  ): Promise<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }> {
    const visitedNodes = new Set<string>();
    const matchedEdgesMap = new Map<string, KnowledgeGraphEdge>();

    const queue: Array<{ id: string; currentDepth: number }> = [{ id: entityId, currentDepth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.currentDepth > depth || visitedNodes.has(item.id)) {
        continue;
      }

      visitedNodes.add(item.id);

      // Find edges connected to current entity node
      const connectedEdges = this.edges.filter(
        (e) => e.sourceId === item.id || e.targetId === item.id,
      );

      for (const edge of connectedEdges) {
        const edgeKey = `${edge.sourceId}->${edge.relation}->${edge.targetId}`;
        matchedEdgesMap.set(edgeKey, edge);

        const neighborId = edge.sourceId === item.id ? edge.targetId : edge.sourceId;
        if (!visitedNodes.has(neighborId)) {
          queue.push({ id: neighborId, currentDepth: item.currentDepth + 1 });
        }
      }
    }

    const matchedNodes = Array.from(visitedNodes)
      .map((id) => this.nodes.get(id))
      .filter((n): n is KnowledgeGraphNode => Boolean(n));

    return {
      nodes: matchedNodes,
      edges: Array.from(matchedEdgesMap.values()),
    };
  }
}
