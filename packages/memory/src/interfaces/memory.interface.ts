export interface MemoryRecord {
  id: string;
  sessionId: string;
  type: 'short_term' | 'scratchpad' | 'episodic' | 'semantic' | 'procedural' | 'generative' | (string & {});
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

export interface RecencyDecayOptions {
  /** Decay rate multiplier per decay unit (e.g. 0.995). Default: 0.995 */
  decayRate?: number;
  /** Duration of one decay unit in milliseconds. Default: 3,600,000 (1 hour) */
  decayUnitMs?: number;
  /** Alternative half-life in hours for exponential decay formula */
  halfLifeHours?: number;
}

export interface TriFactorWeights {
  /** Weight assigned to Recency score component. Default: 0.3 */
  recency?: number;
  /** Weight assigned to Importance score component. Default: 0.3 */
  importance?: number;
  /** Weight assigned to Relevance score component. Default: 0.4 */
  relevance?: number;
}

export interface MemoryQueryOptions {
  sessionId?: string;
  limit?: number;
  type?: string;
  /** Minimum normalized composite score required for inclusion [0, 1] */
  minScoreCutoff?: number;
  /** Custom weights for Stanford Tri-Factor scoring */
  weights?: TriFactorWeights;
  /** Custom decay configuration for recency calculation */
  decayOptions?: RecencyDecayOptions;
  /** Pre-computed query embedding vector for semantic cosine similarity */
  queryEmbedding?: number[];
}

export interface ScoredMemoryRecord {
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

export interface AgentMemoryStore {
  save(record: MemoryRecord): Promise<void>;
  recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]>;
  clear?(sessionId?: string): Promise<void>;
}

export interface SemanticMatch {
  record: MemoryRecord;
  score: number;
}

export interface SemanticStoreProvider {
  save(record: MemoryRecord, embedding?: number[]): Promise<void>;
  search(query: string, limit?: number): Promise<SemanticMatch[]>;
}
