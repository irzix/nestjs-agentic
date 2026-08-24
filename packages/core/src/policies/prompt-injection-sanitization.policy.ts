import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';
import { PromptInjectionSanitizer, type PromptInjectionSanitizerOptions } from '../utils/prompt-injection-sanitizer';

/** Options for configuring PromptInjectionSanitizationPolicy. */
export interface PromptInjectionSanitizationPolicyOptions extends PromptInjectionSanitizerOptions {
  /** Maximum object traversal depth to prevent stack overflows. Default: `50` */
  maxDepth?: number;
}

/**
 * Built-in Output Rail policy that strips known chat-template and role-delimiter
 * injection vectors (e.g. `<|im_start|>`, `[INST]`, `<system>`) from tool output
 * before it re-enters the model's reasoning loop.
 *
 * This mitigates indirect prompt injection carried through tool results (e.g. a
 * scraped web page or third-party API response embedding fake role markers), but
 * it is not a guarantee against every injection technique.
 *
 * @see Greshake et al. (USENIX Security 2023, arXiv:2302.12173)
 *
 * @example
 * ```typescript
 * @Tool({ name: 'fetch_web_page' })
 * @UsePolicies(new PromptInjectionSanitizationPolicy())
 * async fetchWebPage() { ... }
 * ```
 */
export class PromptInjectionSanitizationPolicy implements ToolPolicy {
  private readonly options?: PromptInjectionSanitizerOptions;
  private readonly maxDepth: number;

  constructor(options?: PromptInjectionSanitizationPolicyOptions) {
    this.options = options;
    this.maxDepth = options?.maxDepth ?? 50;
  }

  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return { decision: 'allow' };
  }

  async evaluateOutput(
    _ctx: AgentContext,
    _toolName: string,
    result: unknown,
  ): Promise<PolicyOutputResult> {
    if (result === undefined || result === null) {
      return { decision: 'allow' };
    }

    let modified = false;
    const sanitized = this.sanitizeUnknown(result, () => (modified = true), new WeakMap<object, unknown>(), 0);

    if (modified) {
      return { decision: 'sanitize', sanitizedResult: sanitized };
    }

    return { decision: 'allow' };
  }

  private sanitizeUnknown(
    value: unknown,
    onModified: () => void,
    seenMap: WeakMap<object, unknown>,
    depth: number,
  ): unknown {
    if (depth > this.maxDepth) {
      return value;
    }

    if (typeof value === 'string') {
      const sanitized = PromptInjectionSanitizer.sanitize(value, this.options);
      if (sanitized !== value) {
        onModified();
      }
      return sanitized;
    }

    if (typeof value === 'object' && value !== null) {
      if (seenMap.has(value as object)) {
        return seenMap.get(value as object);
      }

      const placeholder: any = Array.isArray(value) ? [] : {};
      seenMap.set(value as object, placeholder);

      if (Array.isArray(value)) {
        for (const item of value) {
          placeholder.push(this.sanitizeUnknown(item, onModified, seenMap, depth + 1));
        }
        return placeholder;
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        placeholder[k] = this.sanitizeUnknown(v, onModified, seenMap, depth + 1);
      }
      return placeholder;
    }

    return value;
  }
}
