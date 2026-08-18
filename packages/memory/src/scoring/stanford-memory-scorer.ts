import type {
  MemoryRecord,
  RecencyDecayOptions,
  ScoredMemoryRecord,
  TriFactorWeights,
} from '../interfaces/memory.interface';

export interface StanfordScorerOptions {
  weights?: TriFactorWeights;
  decayOptions?: RecencyDecayOptions;
  now?: Date;
  minScoreCutoff?: number;
  queryEmbedding?: number[];
  importanceExtractor?: (record: MemoryRecord) => number;
  /** Whether to apply min-max pool normalization across candidates. Default: true */
  normalizePool?: boolean;
}

/**
 * Production implementation of Stanford Tri-Factor Memory Retrieval Scoring.
 * Implements the foundational algorithm from Park et al. (Stanford University & Google, 2023)
 * combining exponential Recency decay, intrinsic cognitive Importance, and semantic Relevance.
 *
 * @see Park et al., "Generative Agents: Interactive Simulacra of Human Behavior" (arXiv:2304.03442)
 */
export class StanfordMemoryScorer {
  /**
   * Computes the exponential recency decay score for a memory record.
   * R(m) = decayRate^(Δt / decayUnitMs) ∈ [0, 1]
   *
   * @param record The target memory record.
   * @param now Current timestamp reference. Defaults to `new Date()`.
   * @param options Recency decay configuration parameters.
   * @returns Normalized recency decay score in [0, 1].
   */
  static computeRecency(
    record: MemoryRecord,
    now: Date = new Date(),
    options?: RecencyDecayOptions,
  ): number {
    const recordTime = (record.timestamp ?? record.lastAccessedAt ?? now).getTime();
    const currentTime = now.getTime();
    const elapsedMs = Math.max(0, currentTime - recordTime);

    if (options?.halfLifeHours && options.halfLifeHours > 0) {
      const halfLifeMs = options.halfLifeHours * 3600 * 1000;
      const lambda = Math.LN2 / halfLifeMs;
      return Math.min(1.0, Math.max(0.0, Math.exp(-lambda * elapsedMs)));
    }

    const decayRate = options?.decayRate ?? 0.995;
    const decayUnitMs = options?.decayUnitMs ?? 3600 * 1000; // 1 hour

    if (decayUnitMs <= 0 || decayRate <= 0) {
      return 1.0;
    }

    const unitsElapsed = elapsedMs / decayUnitMs;
    const score = Math.pow(decayRate, unitsElapsed);
    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Computes or extracts the cognitive importance score of a memory record.
   * I(m) ∈ [0, 1]
   *
   * @param record The target memory record.
   * @param customExtractor Optional custom function extracting importance rating.
   * @returns Normalized cognitive importance score in [0, 1].
   */
  static computeImportance(
    record: MemoryRecord,
    customExtractor?: (r: MemoryRecord) => number,
  ): number {
    if (customExtractor) {
      const extracted = customExtractor(record);
      return Math.min(1.0, Math.max(0.0, extracted));
    }

    let rawImportance: unknown = record.importance;
    if (rawImportance === undefined && record.metadata && typeof record.metadata === 'object') {
      rawImportance = record.metadata.importance;
    }

    if (typeof rawImportance === 'number' && !Number.isNaN(rawImportance)) {
      // Normalize 1..10 scale to 0..1 if necessary
      if (rawImportance > 1.0 && rawImportance <= 10.0) {
        return rawImportance / 10.0;
      }
      return Math.min(1.0, Math.max(0.0, rawImportance));
    }

    // Default baseline importance for unrated observations
    return 0.5;
  }

  /**
   * Computes the semantic relevance score between a query and a memory record.
   * S(m, q) ∈ [0, 1]
   *
   * @param record The target memory record.
   * @param query Search query text.
   * @param queryEmbedding Optional pre-computed query embedding vector.
   * @returns Normalized relevance score in [0, 1].
   */
  static computeRelevance(
    record: MemoryRecord,
    query: string,
    queryEmbedding?: number[],
  ): number {
    // 1. Vector Cosine Similarity (if embeddings available)
    if (
      queryEmbedding &&
      Array.isArray(queryEmbedding) &&
      queryEmbedding.length > 0 &&
      record.embedding &&
      Array.isArray(record.embedding) &&
      record.embedding.length === queryEmbedding.length
    ) {
      const cosine = this.cosineSimilarity(record.embedding, queryEmbedding);
      return Math.min(1.0, Math.max(0.0, cosine));
    }

    // 2. Lexical & Token Overlap Similarity (deterministic text fallback)
    const qLower = (query ?? '').toLowerCase().trim();
    const cLower = (record.content ?? '').toLowerCase().trim();

    if (!qLower || !cLower) {
      return 0.0;
    }

    // Exact substring containment reward
    if (cLower.includes(qLower)) {
      return 0.95;
    }

    const queryTokens = this.tokenize(qLower);
    const contentTokens = new Set(this.tokenize(cLower));

    if (queryTokens.length === 0 || contentTokens.size === 0) {
      return 0.0;
    }

    let matches = 0;
    for (const token of queryTokens) {
      if (contentTokens.has(token)) {
        matches++;
      }
    }

    const overlapRatio = matches / queryTokens.length;
    return Math.min(1.0, Math.max(0.0, Math.round(overlapRatio * 100) / 100));
  }

  /**
   * Ranks an array of memory candidates according to the Stanford Tri-Factor Formula.
   * Applies Min-Max pool normalization and linear weighting.
   *
   * @param candidates Array of candidate memory records.
   * @param query Target search query or task trigger.
   * @param options Scorer configuration options (weights, decay, cutoff).
   * @returns Ranked array of `ScoredMemoryRecord` entries sorted descending by composite score.
   */
  static rankCandidates(
    candidates: MemoryRecord[],
    query: string,
    options?: StanfordScorerOptions,
  ): ScoredMemoryRecord[] {
    if (candidates.length === 0) {
      return [];
    }

    const now = options?.now ?? new Date();
    const rawScores = candidates.map((m) => ({
      record: m,
      rawR: this.computeRecency(m, now, options?.decayOptions),
      rawI: this.computeImportance(m, options?.importanceExtractor),
      rawS: this.computeRelevance(m, query, options?.queryEmbedding),
    }));

    const normalize = options?.normalizePool ?? true;

    // Calculate pool min and max for normalization
    let minR = Infinity;
    let maxR = -Infinity;
    let minI = Infinity;
    let maxI = -Infinity;
    let minS = Infinity;
    let maxS = -Infinity;

    for (const item of rawScores) {
      if (item.rawR < minR) minR = item.rawR;
      if (item.rawR > maxR) maxR = item.rawR;
      if (item.rawI < minI) minI = item.rawI;
      if (item.rawI > maxI) maxI = item.rawI;
      if (item.rawS < minS) minS = item.rawS;
      if (item.rawS > maxS) maxS = item.rawS;
    }

    // Weights
    const wR = options?.weights?.recency ?? 0.3;
    const wI = options?.weights?.importance ?? 0.3;
    const wS = options?.weights?.relevance ?? 0.4;
    const totalWeight = wR + wI + wS > 0 ? wR + wI + wS : 1.0;
    const normWR = wR / totalWeight;
    const normWI = wI / totalWeight;
    const normWS = wS / totalWeight;

    const scoredList: ScoredMemoryRecord[] = rawScores.map((item) => {
      const normR = normalize && maxR > minR ? (item.rawR - minR) / (maxR - minR) : item.rawR;
      const normI = normalize && maxI > minI ? (item.rawI - minI) / (maxI - minI) : item.rawI;
      const normS = normalize && maxS > minS ? (item.rawS - minS) / (maxS - minS) : item.rawS;

      const finalScore = normWR * normR + normWI * normI + normWS * normS;
      const roundedScore = Math.round(finalScore * 1000) / 1000;

      return {
        record: item.record,
        score: roundedScore,
        recencyScore: Math.round(normR * 1000) / 1000,
        importanceScore: Math.round(normI * 1000) / 1000,
        relevanceScore: Math.round(normS * 1000) / 1000,
      };
    });

    const cutoff = options?.minScoreCutoff ?? 0.0;
    const filtered = scoredList.filter((s) => s.score >= cutoff);

    // Sort descending by composite score
    filtered.sort((a, b) => b.score - a.score);

    return filtered;
  }

  private static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    if (mag === 0) return 0;
    return dot / mag;
  }

  private static tokenize(text: string): string[] {
    return text
      .split(/[\s,.;:!?()[\]{}"'`/\\#*+\-_]+/)
      .filter((t) => t.length > 1);
  }
}
