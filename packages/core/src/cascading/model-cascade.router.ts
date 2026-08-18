import type {
  CascadeConfig,
  CascadeOptions,
  CascadeTier,
  CascadedModelResponse,
} from '../interfaces/cascade.interface';
import type { ModelAdapter, ModelRequest } from '../interfaces/model.interface';
import { ModelCascadeAdapter } from './model-cascade.adapter';

/**
 * High-level router and factory for FrugalGPT model cascading strategies.
 */
export class ModelCascadeRouter {
  constructor(
    private readonly adapter: ModelAdapter,
    private readonly defaultOptions?: CascadeOptions,
  ) {}

  /**
   * Routes a model request through a configured model cascade.
   */
  async route(
    request: ModelRequest,
    customConfig?: CascadeConfig | CascadeOptions,
  ): Promise<CascadedModelResponse> {
    const config = customConfig ?? this.defaultOptions;
    if (!config) {
      throw new Error('No cascade configuration provided to ModelCascadeRouter.');
    }

    const cascadeAdapter = new ModelCascadeAdapter(this.adapter, config);
    return cascadeAdapter.generate(request);
  }

  /**
   * Creates a ModelCascadeAdapter wrapping the given or default adapter.
   */
  createAdapter(config: CascadeConfig | CascadeOptions): ModelCascadeAdapter {
    return new ModelCascadeAdapter(this.adapter, config);
  }

  /**
   * Fast heuristic estimating query complexity to pre-select initial cascade tier.
   */
  static estimateComplexity(prompt: string): 'simple' | 'moderate' | 'complex' {
    const len = (prompt ?? '').length;
    const lower = (prompt ?? '').toLowerCase();

    const complexKeywords = [
      'prove',
      'derive',
      'optimize',
      'refactor',
      'analyze trade-offs',
      'step by step',
      'architecture',
      'security vulnerability',
      'mathematical proof',
    ];

    for (const kw of complexKeywords) {
      if (lower.includes(kw)) return 'complex';
    }

    if (len > 1500) return 'complex';
    if (len > 300) return 'moderate';
    return 'simple';
  }
}
