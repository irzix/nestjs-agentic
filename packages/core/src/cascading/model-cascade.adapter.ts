import { CascadeConfigurationError, CascadeExhaustedError } from '../errors';
import type {
  CascadeConfig,
  CascadeOptions,
  CascadeTier,
  CascadedModelResponse,
  CascadeMetadata,
} from '../interfaces/cascade.interface';
import type {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ModelUsage,
} from '../interfaces/model.interface';
import { defaultConfidenceExtractor } from './confidence-extractors';

/**
 * Experimental confidence-threshold model cascading.
 * Wraps an underlying ModelAdapter and orchestrates sequential model escalation
 * based on configurable confidence thresholds. Cost and quality depend on the workload
 * and evaluator; the default text heuristics are not calibrated probabilities.
 *
 * @see Chen et al. (Stanford University, NeurIPS 2023, arXiv:2305.05176)
 */
export class ModelCascadeAdapter implements ModelAdapter {
  private readonly tiers: CascadeTier[];
  private readonly defaultThreshold: number;
  private readonly fallbackStrategy: 'accept_last' | 'throw';
  private readonly onEscalate?: CascadeOptions['onEscalate'];

  constructor(
    private readonly underlyingAdapter: ModelAdapter,
    config: CascadeConfig | CascadeOptions,
  ) {
    if ('tiers' in config && Array.isArray(config.tiers) && config.tiers.length > 0) {
      this.tiers = config.tiers;
      const explicitThreshold =
        'defaultConfidenceThreshold' in config
          ? config.defaultConfidenceThreshold
          : (config as CascadeConfig).confidenceThreshold;
      this.defaultThreshold = explicitThreshold ?? 0.85;
      this.fallbackStrategy = config.fallbackStrategy ?? 'accept_last';
      this.onEscalate = config.onEscalate;
    } else if ('fastModel' in config && 'reasoningModel' in config) {
      const fastTier: CascadeTier = {
        model: config.fastModel,
        confidenceThreshold: config.confidenceThreshold ?? 0.85,
        extractorFn: config.extractorFn,
      };
      const reasoningTier: CascadeTier = {
        model: config.reasoningModel,
        confidenceThreshold: 0.0,
        extractorFn: config.extractorFn,
      };
      this.tiers = [fastTier, reasoningTier];
      this.defaultThreshold = config.confidenceThreshold ?? 0.85;
      this.fallbackStrategy = config.fallbackStrategy ?? 'accept_last';
      this.onEscalate = config.onEscalate;
    } else {
      throw new CascadeConfigurationError(
        'Must provide either a non-empty "tiers" array or both "fastModel" and "reasoningModel".',
      );
    }

    if (this.tiers.length === 0) {
      throw new CascadeConfigurationError('At least one CascadeTier must be configured.');
    }
  }

  /**
   * Executes a model generation turn through the FrugalGPT cascade.
   */
  async generate(request: ModelRequest): Promise<CascadedModelResponse> {
    if (request.signal?.aborted) {
      throw request.signal.reason ?? new Error('Execution aborted.');
    }

    const cumulativeUsage: ModelUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    for (let i = 0; i < this.tiers.length; i++) {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new Error('Execution aborted.');
      }

      const tier = this.tiers[i];
      const isFinalTier = i === this.tiers.length - 1;
      const threshold = tier.confidenceThreshold ?? (isFinalTier ? 0.0 : this.defaultThreshold);

      const tierRequest: ModelRequest = {
        ...request,
        model: tier.model,
      };

      let tierResponse: ModelResponse;
      try {
        if (tier.timeoutMs && tier.timeoutMs > 0) {
          tierResponse = await this.executeWithTimeout(tierRequest, tier.timeoutMs);
        } else {
          tierResponse = await this.underlyingAdapter.generate(tierRequest);
        }
      } catch (err: unknown) {
        if (request.signal?.aborted) {
          throw request.signal.reason ?? err;
        }

        // If non-final tier fails or times out, escalate to next tier
        if (!isFinalTier) {
          if (this.onEscalate) {
            await this.onEscalate({
              fromTier: i,
              toTier: i + 1,
              fromModel: tier.model.model,
              toModel: this.tiers[i + 1].model.model,
              confidence: 0,
              threshold,
              reason: `Tier execution failed: ${(err as Error).message}`,
            });
          }
          continue;
        }
        throw err;
      }

      // Accumulate token usage across all attempted tiers
      if (tierResponse.usage) {
        cumulativeUsage.inputTokens =
          (cumulativeUsage.inputTokens ?? 0) + (tierResponse.usage.inputTokens ?? 0);
        cumulativeUsage.outputTokens =
          (cumulativeUsage.outputTokens ?? 0) + (tierResponse.usage.outputTokens ?? 0);
        cumulativeUsage.totalTokens =
          (cumulativeUsage.totalTokens ?? 0) + (tierResponse.usage.totalTokens ?? 0);
      }

      // Evaluate confidence
      const extractor = tier.extractorFn ?? defaultConfidenceExtractor;
      const confidence = await extractor(tierResponse.content, tierResponse, tierRequest);

      // Check if threshold satisfied
      if (confidence >= threshold) {
        const metadata: CascadeMetadata = {
          tiersAttempted: i + 1,
          finalTierIndex: i,
          finalModel: tier.model.model,
          confidenceScore: confidence,
          cumulativeUsage,
          escalated: i > 0,
        };

        return {
          ...tierResponse,
          usage: cumulativeUsage,
          cascadeMetadata: metadata,
        };
      }

      // If final tier reached and threshold not met
      if (isFinalTier) {
        if (this.fallbackStrategy === 'throw') {
          throw new CascadeExhaustedError(
            this.tiers.length,
            confidence,
            threshold,
            tier.model.model,
          );
        }

        return {
          ...tierResponse,
          usage: cumulativeUsage,
          cascadeMetadata: {
            tiersAttempted: this.tiers.length,
            finalTierIndex: i,
            finalModel: tier.model.model,
            confidenceScore: confidence,
            cumulativeUsage,
            escalated: i > 0,
          },
        };
      }

      // Escalate to next tier
      if (this.onEscalate) {
        await this.onEscalate({
          fromTier: i,
          toTier: i + 1,
          fromModel: tier.model.model,
          toModel: this.tiers[i + 1].model.model,
          confidence,
          threshold,
          reason: `Confidence ${confidence.toFixed(2)} < threshold ${threshold.toFixed(2)}`,
        });
      }
    }

    // Safety fallback: unreachable in valid cascade loops
    throw new CascadeConfigurationError('Cascade execution completed without resolving a model tier.');
  }

  /**
   * Buffers generation until a tier is accepted, then emits that exact response.
   * Cascading cannot expose unvalidated tokens or regenerate an accepted answer.
   * This is stream-compatible, but does not provide incremental token delivery.
   */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const response = await this.generate(request);
    if (request.signal?.aborted) {
      throw request.signal.reason ?? new Error('Execution aborted.');
    }
    if (response.content) yield { type: 'token', text: response.content };
    yield { type: 'response', response };
  }

  private async executeWithTimeout(
    request: ModelRequest,
    timeoutMs: number,
  ): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Tier execution timed out after ${timeoutMs}ms`)), timeoutMs);

    // Merge with caller signal if present
    const onAbort = () => {
      controller.abort(request.signal?.reason);
    };

    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timer);
        throw request.signal.reason ?? new Error('Execution aborted.');
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const reqWithSignal: ModelRequest = {
        ...request,
        signal: controller.signal,
      };
      return await this.underlyingAdapter.generate(reqWithSignal);
    } finally {
      clearTimeout(timer);
      if (request.signal) {
        request.signal.removeEventListener('abort', onAbort);
      }
    }
  }
}
