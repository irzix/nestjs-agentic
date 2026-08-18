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
   * Estimates query complexity based on structural features (token/character volume, code fences)
   * or a custom classifier function, completely independent of natural language keywords.
   */
  static estimateComplexity(
    prompt: string,
    classifierFn?: (prompt: string) => 'simple' | 'moderate' | 'complex',
  ): 'simple' | 'moderate' | 'complex' {
    if (classifierFn) {
      return classifierFn(prompt);
    }

    const text = prompt ?? '';
    const len = text.length;

    // Structural indicators: code fences, JSON schemas, nested structured data
    if (text.includes('```') || (text.includes('{') && text.includes('}') && len > 300)) {
      return len > 800 ? 'complex' : 'moderate';
    }

    if (len > 1200) return 'complex';
    if (len > 250) return 'moderate';
    return 'simple';
  }
}
