/**
 * Node entity in the Knowledge Graph RAG store.
 */
export interface KnowledgeGraphNode {
  /** Unique entity identifier (e.g. "acc_101", "policy_finance_01"). */
  id: string;
  /** Human-readable label or entity type (e.g. "Account", "Policy", "User"). */
  label: string;
  /** Property attributes associated with this node. */
  properties?: Record<string, unknown>;
}

/**
 * Directed edge representing a relation between two entities in the Knowledge Graph.
 */
export interface KnowledgeGraphEdge {
  /** Source entity ID. */
  sourceId: string;
  /** Target entity ID. */
  targetId: string;
  /** Relationship type label (e.g. "OWNED_BY", "GOVERNED_BY", "REQUIRES_ROLE"). */
  relation: string;
  /** Optional edge weight or confidence score. */
  weight?: number;
}

/**
 * Knowledge Graph Provider interface.
 * Implemented by InMemoryKnowledgeGraphProvider or external Graph DB connectors (e.g. Neo4j).
 */
export interface KnowledgeGraphProvider {
  /**
   * Adds an entity node to the Knowledge Graph.
   */
  addNode(node: KnowledgeGraphNode): Promise<void>;

  /**
   * Adds a relational edge between two entity nodes in the Knowledge Graph.
   */
  addEdge(edge: KnowledgeGraphEdge): Promise<void>;

  /**
   * Queries a connected subgraph originating from a target entity ID up to a specified traversal depth.
   *
   * @param entityId The root entity node ID.
   * @param depth Traversal depth limit (default: 2).
   * @returns Connected nodes and edges forming the subgraph.
   */
  querySubGraph(
    entityId: string,
    depth?: number,
  ): Promise<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }>;

  /**
   * Searches entity nodes matching a keyword against ID, label, or property attributes.
   */
  searchNodes?(keyword: string): Promise<KnowledgeGraphNode[]> | KnowledgeGraphNode[];
}
