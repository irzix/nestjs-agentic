/**
 * Core interface representing an observation, fact, conversation turn, or procedural playbook
 * stored across short-term, working, semantic, episodic, or generative memory tiers.
 */
export interface MemoryRecord {
  /** Unique memory record identifier */
  id: string;
  /** Session or thread identifier for conversation scoping */
  sessionId: string;
  /** Memory tier classification */
  type: 'short_term' | 'scratchpad' | 'episodic' | 'semantic' | 'procedural' | 'generative' | (string & {});
  /** Text content or serialized instructions of the memory */
  content: string;
  /** Intrinsic cognitive importance score in [0, 1]. Default: 0.5 */
  importance?: number;
  /** Optional pre-computed semantic embedding vector for relevance scoring */
  embedding?: number[];
  /** Arbitrary metadata attached to the memory entry */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  timestamp?: Date;
  /** Timestamp when this memory was last retrieved or accessed */
  lastAccessedAt?: Date;
}

/**
 * Configuration options controlling exponential recency decay calculations.
 *
 * @see Park et al. (Stanford University & Google, 2023, arXiv:2304.03442)
 */
export interface RecencyDecayOptions {
  /** Decay rate multiplier per decay unit (e.g. 0.995). Default: 0.995 */
  decayRate?: number;
  /** Duration of one decay unit in milliseconds. Default: 3,600,000 (1 hour) */
  decayUnitMs?: number;
  /** Alternative half-life in hours for exponential decay formula */
  halfLifeHours?: number;
}

/**
 * Relative linear weighting factors for the Stanford Tri-Factor Memory Retrieval Formula.
 * Score(m, q) = α · Recency(m) + β · Importance(m) + γ · Relevance(m, q)
 */
export interface TriFactorWeights {
  /** Weight assigned to Recency score component (α). Default: 0.3 */
  recency?: number;
  /** Weight assigned to Importance score component (β). Default: 0.3 */
  importance?: number;
  /** Weight assigned to Relevance score component (γ). Default: 0.4 */
  relevance?: number;
}

/**
 * Query and filter options for memory retrieval operations.
 */
export interface MemoryQueryOptions {
  /** Target session identifier to scope retrieval */
  sessionId?: string;
  /** Maximum number of memory records to return. Default: 10 */
  limit?: number;
  /** Optional memory type filter (e.g. 'episodic', 'procedural') */
  type?: string;
  /** Minimum normalized composite score required for inclusion in results [0, 1] */
  minScoreCutoff?: number;
  /** Custom linear weights for Stanford Tri-Factor scoring */
  weights?: TriFactorWeights;
  /** Custom decay configuration for exponential recency calculation */
  decayOptions?: RecencyDecayOptions;
  /** Pre-computed query embedding vector for semantic cosine similarity */
  queryEmbedding?: number[];
}

/**
 * Memory record annotated with calculated Stanford Tri-Factor score components.
 */
export interface ScoredMemoryRecord {
  /** The underlying memory record */
  record: MemoryRecord;
  /** Composite Stanford Tri-Factor score in [0, 1] */
  score: number;
  /** Normalized recency component in [0, 1] */
  recencyScore: number;
  /** Normalized importance component in [0, 1] */
  importanceScore: number;
  /** Normalized relevance component in [0, 1] */
  relevanceScore: number;
}

/**
 * Universal contract implemented by all memory stores in the framework.
 */
export interface AgentMemoryStore {
  /**
   * Persists a memory record into the store.
   * @param record The memory record to store.
   */
  save(record: MemoryRecord): Promise<void>;

  /**
   * Recalls relevant memory records matching a query.
   * @param query Search query text or task trigger.
   * @param options Query and filtering options.
   */
  recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]>;

  /**
   * Optional cleanup method clearing records for a session or the entire store.
   * @param sessionId Optional session identifier to clear.
   */
  clear?(sessionId?: string): Promise<void>;
}

/**
 * Semantic vector search match result with similarity score.
 */
export interface SemanticMatch {
  /** The matching memory record */
  record: MemoryRecord;
  /** Similarity score */
  score: number;
}

/**
 * External provider contract for semantic vector search implementations.
 */
export interface SemanticStoreProvider {
  /**
   * Stores a record with an optional embedding vector.
   * @param record The memory record to store.
   * @param embedding Pre-computed vector embeddings.
   */
  save(record: MemoryRecord, embedding?: number[]): Promise<void>;

  /**
   * Performs semantic similarity search against the query.
   * @param query Query text.
   * @param limit Maximum results.
   */
  search(query: string, limit?: number): Promise<SemanticMatch[]>;
}
