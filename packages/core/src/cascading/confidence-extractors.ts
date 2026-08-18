import type { ModelRequest, ModelResponse } from '../interfaces/model.interface';

const UNCERTAINTY_HEDGES = [
  /i\s+am\s+not\s+(?:entirely\s+|completely\s+)?(?:sure|certain|confident)/i,
  /i(?:'m|\s+am)\s+unable\s+to\s+(?:determine|verify|confirm|answer)/i,
  /i\s+do\s+not\s+have\s+(?:enough\s+|sufficient\s+)?information/i,
  /as\s+an\s+ai(?:,\s*i\s+cannot|,\s*i\s+am\s+unable)/i,
  /it\s+is\s+(?:unclear|uncertain|ambiguous|difficult\s+to\s+say)/i,
  /might\s+be\s+(?:incorrect|inaccurate|wrong)/i,
  /cannot\s+guarantee\s+the\s+accuracy/i,
  /i\s+could\s+be\s+mistaken/i,
];

/**
 * Extracts explicitly verbalized confidence scores formatted in the LLM response text.
 * Examples: `[Confidence: 0.95]`, `Confidence: 85%`, `Score: 9/10`.
 *
 * @returns Normalized score in [0, 1] or `null` if no pattern matched.
 */
export function extractVerbalizedConfidence(content: string): number | null {
  if (!content) return null;

  // Pattern 1: [Confidence: 0.95] or Confidence: 0.95 or confidence: .95
  const decimalMatch = content.match(/(?:confidence|certainty|confidence\s+score)\s*[:=]\s*(\d*\.?\d+)/i);
  if (decimalMatch && decimalMatch[1]) {
    const val = parseFloat(decimalMatch[1]);
    if (!Number.isNaN(val)) {
      if (val >= 0 && val <= 1.0) return val;
      if (val > 1.0 && val <= 100.0) return val / 100.0;
    }
  }

  // Pattern 2: Confidence: 85% or 95% confident
  const percentageMatch = content.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:confidence|certain|sure)/i) ??
    content.match(/(?:confidence|certainty)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (percentageMatch && percentageMatch[1]) {
    const val = parseFloat(percentageMatch[1]);
    if (!Number.isNaN(val) && val >= 0 && val <= 100) {
      return Math.min(1.0, Math.max(0.0, val / 100.0));
    }
  }

  // Pattern 3: Score: 8/10 or 4/5
  const ratioMatch = content.match(/(?:confidence|score)\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i);
  if (ratioMatch && ratioMatch[1] && ratioMatch[2]) {
    const num = parseFloat(ratioMatch[1]);
    const denom = parseFloat(ratioMatch[2]);
    if (!Number.isNaN(num) && !Number.isNaN(denom) && denom > 0) {
      return Math.min(1.0, Math.max(0.0, num / denom));
    }
  }

  return null;
}

export interface HeuristicConfidenceOptions {
  /** Baseline confidence score assigned to structured non-empty prose. Default: 0.80 */
  baselineScore?: number;
  /** High confidence score assigned when explicit tool calls are requested. Default: 0.92 */
  toolCallScore?: number;
  /** Penalty subtracted for each detected uncertainty hedging phrase. Default: 0.30 */
  uncertaintyPenalty?: number;
  /** Bonus added when structured output (markdown code blocks, bullet points) is detected. Default: 0.10 */
  structureBonus?: number;
  /** Score assigned to very short or trivial responses under minLength. Default: 0.35 */
  shortResponseScore?: number;
  /** Minimum character length threshold for non-trivial responses. Default: 15 */
  minLength?: number;
  /** Custom additional uncertainty regex patterns to detect. */
  additionalHedgePatterns?: RegExp[];
}

/**
 * Heuristically scores response confidence based on tool usage, answer completeness,
 * and uncertainty hedging expressions (Stanford FrugalGPT heuristic).
 */
export function extractHeuristicConfidence(
  content: string,
  response: ModelResponse,
  options?: HeuristicConfidenceOptions,
): number {
  const toolScore = options?.toolCallScore ?? 0.92;
  const baseline = options?.baselineScore ?? 0.80;
  const penalty = options?.uncertaintyPenalty ?? 0.30;
  const bonus = options?.structureBonus ?? 0.10;
  const shortScore = options?.shortResponseScore ?? 0.35;
  const minLen = options?.minLength ?? 15;

  // 1. Tool calls express direct, structured operational intent
  if (response.toolCalls && response.toolCalls.length > 0) {
    return toolScore;
  }

  const trimmed = (content ?? '').trim();
  if (trimmed.length === 0) {
    return 0.0;
  }

  if (trimmed.length < minLen) {
    return shortScore;
  }

  let score = baseline;

  // 2. Penalize for explicit uncertainty hedging expressions
  const patterns = options?.additionalHedgePatterns
    ? [...UNCERTAINTY_HEDGES, ...options.additionalHedgePatterns]
    : UNCERTAINTY_HEDGES;

  for (const hedgeRegex of patterns) {
    if (hedgeRegex.test(trimmed)) {
      score -= penalty;
    }
  }

  // 3. Reward structured output (markdown headers, code blocks, lists)
  if (trimmed.includes('```') || /^[*-]\s+/m.test(trimmed) || /^\d+\.\s+/m.test(trimmed)) {
    score += bonus;
  }

  return Math.min(1.0, Math.max(0.0, Math.round(score * 100) / 100));
}

/**
 * Default FrugalGPT confidence extractor evaluating verbalized scores first,
 * then falling back to heuristic uncertainty analysis.
 */
export function defaultConfidenceExtractor(
  content: string,
  response: ModelResponse,
  request: ModelRequest,
  options?: HeuristicConfidenceOptions,
): number {
  const verbalized = extractVerbalizedConfidence(content);
  if (verbalized !== null) {
    return verbalized;
  }
  return extractHeuristicConfidence(content, response, options);
}
