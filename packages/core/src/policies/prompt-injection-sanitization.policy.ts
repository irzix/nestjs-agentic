import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';
import { PromptInjectionSanitizer, type PromptInjectionSanitizerOptions } from '../utils/prompt-injection-sanitizer';

/** Options for configuring PromptInjectionSanitizationPolicy. */
export interface PromptInjectionSanitizationPolicyOptions extends PromptInjectionSanitizerOptions {
  /** Maximum object traversal depth. Structures deeper than this are denied. Default: `50` */
  maxDepth?: number;
}

/** Keys that could pollute the prototype chain when assigned onto a plain object clone. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Narrows a value to a plain object (object literal or `Object.create(null)`), excluding arrays and class instances. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Built-in Output Rail policy that strips known chat-template and role-delimiter
 * injection vectors (e.g. `<|im_start|>`, `[INST]`, `<system>`) from tool output
 * before it re-enters the model's reasoning loop.
 *
 * Only plain objects and arrays are traversed; non-plain values (Date, Map, class
 * instances, buffers, etc.) are passed through unchanged to avoid corrupting structured
 * tool output. Prototype-polluting keys (`__proto__`, `prototype`, `constructor`) are
 * skipped during cloning.
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

  /**
   * Pre-execution hook. This is a pure Output Rail, so tool invocation is always allowed.
   *
   * @returns Always `{ decision: 'allow' }`.
   */
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return { decision: 'allow' };
  }

  /**
   * Post-execution Output Rail hook. Recursively sanitizes strings in the tool result.
   *
   * @param result The raw tool output.
   * @returns `{ decision: 'sanitize', sanitizedResult }` if any string was modified;
   *          `{ decision: 'deny' }` if the structure exceeds `maxDepth` (to avoid returning
   *          an uninspected subtree); otherwise `{ decision: 'allow' }`.
   */
  async evaluateOutput(
    _ctx: AgentContext,
    _toolName: string,
    result: unknown,
  ): Promise<PolicyOutputResult> {
    if (result === undefined || result === null) {
      return { decision: 'allow' };
    }

    let modified = false;
    let depthExceeded = false;

    const sanitized = this.sanitizeUnknown(
      result,
      () => (modified = true),
      () => (depthExceeded = true),
      new WeakMap<object, unknown>(),
      0,
    );

    // Never return a partially-inspected structure as allowed: a delimiter could be
    // hiding in the subtree we refused to descend into.
    if (depthExceeded) {
      return {
        decision: 'deny',
        reason: `Tool output exceeds maximum sanitization depth (${this.maxDepth}); unable to fully inspect for prompt-injection delimiters.`,
      };
    }

    if (modified) {
      return { decision: 'sanitize', sanitizedResult: sanitized };
    }

    return { decision: 'allow' };
  }

  private sanitizeUnknown(
    value: unknown,
    onModified: () => void,
    onDepthExceeded: () => void,
    seenMap: WeakMap<object, unknown>,
    depth: number,
  ): unknown {
    if (typeof value === 'string') {
      const sanitized = PromptInjectionSanitizer.sanitize(value, this.options);
      if (sanitized !== value) {
        onModified();
      }
      return sanitized;
    }

    // Only plain arrays/records are cloned+traversed. Non-plain objects (Date, Map,
    // class instances, etc.) are returned unchanged to preserve their semantics.
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainRecord(value)) {
      return value;
    }

    if (depth >= this.maxDepth) {
      onDepthExceeded();
      return value;
    }

    const container = value as object;
    if (seenMap.has(container)) {
      return seenMap.get(container);
    }

    if (isArray) {
      const clone: unknown[] = [];
      seenMap.set(container, clone);
      for (const item of value as unknown[]) {
        clone.push(this.sanitizeUnknown(item, onModified, onDepthExceeded, seenMap, depth + 1));
      }
      return clone;
    }

    const clone: Record<string, unknown> = {};
    seenMap.set(container, clone);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) {
        continue;
      }
      clone[k] = this.sanitizeUnknown(v, onModified, onDepthExceeded, seenMap, depth + 1);
    }
    return clone;
  }
}
