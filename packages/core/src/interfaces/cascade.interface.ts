import type { ModelMessage, ModelRequest, ModelResponse, ModelUsage } from './model.interface';
import type { ModelConfig } from './runtime.interface';

/**
 * Single model tier in a FrugalGPT model cascade.
 * @see Chen et al. (Stanford University, NeurIPS 2023, arXiv:2305.05176)
 */
export interface CascadeTier {
  /** Model provider and configuration for this tier. */
  model: ModelConfig;
  /**
   * Confidence threshold tau in [0, 1] required to accept this tier's response.
   * If the evaluated confidence is >= threshold, the cascade terminates early.
   * Default: 0.85
   */
  confidenceThreshold?: number;
  /**
   * Custom function extracting a normalized confidence score in [0, 1] from the response.
   */
  extractorFn?: (
    content: string,
    response: ModelResponse,
    request: ModelRequest,
  ) => number | Promise<number>;
  /**
   * Optional timeout in milliseconds for this specific tier before auto-escalating.
   */
  timeoutMs?: number;
}

/**
 * Event payload dispatched when a cascade escalates from a lower-cost tier to a higher-capability tier.
 */
export interface CascadeEscalationEvent {
  fromTier: number;
  toTier: number;
  fromModel: string;
  toModel: string;
  confidence: number;
  threshold: number;
  reason?: string;
}

/**
 * Execution metadata attached to a cascaded model response.
 */
export interface CascadeMetadata {
  /** Number of cascade tiers invoked during the turn. */
  tiersAttempted: number;
  /** Zero-based index of the final accepted model tier. */
  finalTierIndex: number;
  /** Name of the final accepted model. */
  finalModel: string;
  /** Evaluated confidence score for the final response in [0, 1]. */
  confidenceScore: number;
  /** Total token usage accumulated across all attempted cascade tiers. */
  cumulativeUsage: ModelUsage;
  /** Whether the request was escalated past the initial fast model. */
  escalated: boolean;
}

/**
 * Extended ModelResponse containing FrugalGPT execution and token accounting metadata.
 */
export interface CascadedModelResponse extends ModelResponse {
  cascadeMetadata?: CascadeMetadata;
}

/**
 * Full configuration for FrugalGPT model cascading.
 * Supports both standard 2-tier (fastModel -> reasoningModel) and arbitrary N-tier cascades.
 */
export interface CascadeConfig {
  /** Fast, cost-efficient model queried first (e.g. gpt-4o-mini, haiku). */
  fastModel: ModelConfig;
  /** Heavyweight reasoning model escalated to when confidence is below threshold (e.g. gpt-4o, sonnet, o3-mini). */
  reasoningModel: ModelConfig;
  /** Confidence score threshold tau in [0, 1] to accept fastModel output. Default: 0.85 */
  confidenceThreshold?: number;
  /** Custom confidence extractor function. */
  extractorFn?: (
    content: string,
    response: ModelResponse,
    request: ModelRequest,
  ) => number | Promise<number>;
  /** Optional arbitrary N-tier cascade specification overriding fastModel/reasoningModel. */
  tiers?: CascadeTier[];
  /**
   * Behavior when all cascade tiers are exhausted without reaching the threshold.
   * - `accept_last`: Accept the final tier's response regardless of confidence score (default).
   * - `throw`: Throw a CascadeExhaustedError.
   */
  fallbackStrategy?: 'accept_last' | 'throw';
  /** Optional observer callback invoked whenever an escalation occurs. */
  onEscalate?: (event: CascadeEscalationEvent) => void | Promise<void>;
}

/**
 * Options used when constructing a ModelCascadeRouter or ModelCascadeAdapter.
 */
export interface CascadeOptions {
  /** Ordered list of cascade tiers from lowest cost to highest capability. */
  tiers: CascadeTier[];
  /** Global default confidence threshold. Default: 0.85 */
  defaultConfidenceThreshold?: number;
  /** Fallback strategy if all tiers fail to meet the threshold. Default: 'accept_last' */
  fallbackStrategy?: 'accept_last' | 'throw';
  /** Optional observer callback invoked whenever an escalation occurs. */
  onEscalate?: (event: CascadeEscalationEvent) => void | Promise<void>;
}
