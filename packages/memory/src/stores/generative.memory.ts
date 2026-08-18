import { randomUUID } from 'crypto';
import type {
  AgentMemoryStore,
  MemoryQueryOptions,
  MemoryRecord,
  RecencyDecayOptions,
  ScoredMemoryRecord,
  TriFactorWeights,
} from '../interfaces/memory.interface';
import { StanfordMemoryScorer } from '../scoring/stanford-memory-scorer';

export interface GenerativeMemoryOptions {
  defaultWeights?: TriFactorWeights;
  defaultDecayOptions?: RecencyDecayOptions;
  importanceExtractor?: (record: MemoryRecord) => number;
}

/**
 * Generative Memory Store implementing Stanford Tri-Factor Memory Retrieval.
 * Ranks candidate observations dynamically using exponential Recency decay,
 * cognitive Importance, and semantic Relevance.
 *
 * @see Park et al. (Stanford University & Google, 2023, arXiv:2304.03442)
 */
export class GenerativeMemoryStore implements AgentMemoryStore {
  private readonly records = new Map<string, MemoryRecord[]>();
  private readonly defaultWeights?: TriFactorWeights;
  private readonly defaultDecayOptions?: RecencyDecayOptions;
  private readonly importanceExtractor?: (record: MemoryRecord) => number;

  constructor(options?: GenerativeMemoryOptions) {
    this.defaultWeights = options?.defaultWeights;
    this.defaultDecayOptions = options?.defaultDecayOptions;
    this.importanceExtractor = options?.importanceExtractor;
  }

  /**
   * Saves a new memory record into the generative memory store.
   * Automatically computes intrinsic cognitive importance and assigns timestamps.
   *
   * @param record The memory record to persist.
   */
  async save(record: MemoryRecord): Promise<void> {
    const item: MemoryRecord = {
      ...record,
      id: record.id || randomUUID(),
      type: record.type || 'generative',
      importance: StanfordMemoryScorer.computeImportance(record, this.importanceExtractor),
      timestamp: record.timestamp || new Date(),
      lastAccessedAt: new Date(),
    };

    const sessionList = this.records.get(item.sessionId) ?? [];
    sessionList.push(item);
    this.records.set(item.sessionId, sessionList);
  }

  /**
   * Recalls top-K relevant memories ranked by the Stanford Tri-Factor Formula.
   *
   * @param query Search query text or task trigger.
   * @param options Query and filter options (weights, decay, limit, score cutoff).
   * @returns Array of matching `MemoryRecord` entries sorted descending by composite score.
   */
  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    const scored = await this.recallScored(query, options);
    return scored.map((s) => s.record);
  }

  /**
   * Recalls memories along with their detailed Tri-Factor score components (Recency, Importance, Relevance).
   *
   * @param query Search query text or task trigger.
   * @param options Query and filter options (weights, decay, limit, score cutoff).
   * @returns Detailed `ScoredMemoryRecord` entries including individual factor breakdowns.
   */
  async recallScored(
    query: string,
    options?: MemoryQueryOptions,
  ): Promise<ScoredMemoryRecord[]> {
    let candidates: MemoryRecord[] = [];
    if (options?.sessionId) {
      candidates = this.records.get(options.sessionId) ?? [];
    } else {
      candidates = Array.from(this.records.values()).flat();
    }

    if (options?.type) {
      candidates = candidates.filter((c) => c.type === options.type);
    }

    if (candidates.length === 0) {
      return [];
    }

    const scored = StanfordMemoryScorer.rankCandidates(candidates, query, {
      weights: options?.weights ?? this.defaultWeights,
      decayOptions: options?.decayOptions ?? this.defaultDecayOptions,
      minScoreCutoff: options?.minScoreCutoff,
      queryEmbedding: options?.queryEmbedding,
      importanceExtractor: this.importanceExtractor,
    });

    const now = new Date();
    const limit = options?.limit ?? 10;
    const topScored = scored.slice(0, limit);

    // Update lastAccessedAt for retrieved memories
    for (const item of topScored) {
      item.record.lastAccessedAt = now;
    }

    return topScored;
  }

  /**
   * Retrieves all records for a session without applying ranking.
   *
   * @param sessionId Optional session identifier.
   * @returns All stored `MemoryRecord` entries.
   */
  async getAll(sessionId?: string): Promise<MemoryRecord[]> {
    if (sessionId) {
      return this.records.get(sessionId) ?? [];
    }
    return Array.from(this.records.values()).flat();
  }

  /**
   * Clears memory records for a specific session or the entire store.
   *
   * @param sessionId Optional session identifier to clear.
   */
  async clear(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.records.delete(sessionId);
    } else {
      this.records.clear();
    }
  }
}
