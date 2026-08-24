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

/** What a traversal does when a plain object/array is nested deeper than `maxDepth`. */
export type DepthExceededBehavior =
  /** Return the subtree unchanged, without inspecting it further (legacy behavior). */
  | 'passthrough'
  /** Signal via `RedactionTraversalResult.depthExceeded` so the caller can refuse the output. */
  | 'deny';

export interface RedactionTraversalOptions {
  /** Maximum object traversal depth. */
  maxDepth: number;

  /** Transforms a string leaf value. Return the input unchanged if nothing was redacted. */
  transformString: (value: string) => string;

  /**
   * Optional per-key override invoked before generic traversal of an object property.
   * Return `{ handled: true, value }` to use `value` directly (e.g. masking a sensitive
   * key regardless of its value's type). Return `{ handled: false }` to fall through to
   * generic traversal (string transform, or recursion for nested objects/arrays).
   */
  handleKey?: (
    key: string,
    value: unknown,
  ) => { handled: true; value: unknown } | { handled: false };

  /**
   * Behavior when traversal exceeds `maxDepth`.
   * Default: `'passthrough'`.
   */
  onDepthExceeded?: DepthExceededBehavior;

  /**
   * When `true`, non-plain objects (`Date`, `Map`, `Set`, class instances, etc.) are
   * returned unchanged instead of being cloned into a plain `{}`/`[]`, which would
   * otherwise corrupt their semantics.
   * Default: `false` (clone everything, matching legacy `SecretRedactionPolicy` behavior).
   */
  preserveNonPlainObjects?: boolean;

  /**
   * When `true`, prototype-polluting keys (`__proto__`, `prototype`, `constructor`) are
   * skipped during cloning.
   * Default: `false` (matching legacy `SecretRedactionPolicy` behavior).
   */
  skipForbiddenKeys?: boolean;
}

export interface RedactionTraversalResult {
  /** The (possibly cloned and redacted) value. */
  value: unknown;
  /** Whether any string or keyed value was changed. */
  modified: boolean;
  /** Whether a plain object/array nested deeper than `maxDepth` was encountered. */
  depthExceeded: boolean;
}

/**
 * Recursively walks a value, redacting string leaves via `transformString` (and, optionally,
 * whole keyed properties via `handleKey`). Shared by `SecretRedactionPolicy`,
 * `PiiRedactionPolicy`, and any policy needing safe, circular-reference-aware tree traversal
 * over untrusted tool output.
 */
export function traverseAndRedact(
  root: unknown,
  options: RedactionTraversalOptions,
): RedactionTraversalResult {
  let modified = false;
  let depthExceeded = false;
  const seenMap = new WeakMap<object, unknown>();
  const onDepthExceeded = options.onDepthExceeded ?? 'passthrough';

  function walk(value: unknown, depth: number): unknown {
    // Checked unconditionally at entry (for every type), matching the original
    // SecretRedactionPolicy gate: nodes at depth <= maxDepth are processed,
    // nodes strictly deeper are returned unchanged.
    if (depth > options.maxDepth) {
      if (onDepthExceeded === 'deny') {
        depthExceeded = true;
      }
      return value;
    }

    if (typeof value === 'string') {
      const transformed = options.transformString(value);
      if (transformed !== value) {
        modified = true;
      }
      return transformed;
    }

    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const isArray = Array.isArray(value);
    if (!isArray && options.preserveNonPlainObjects && !isPlainRecord(value)) {
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
        clone.push(walk(item, depth + 1));
      }
      return clone;
    }

    const clone: Record<string, unknown> = {};
    seenMap.set(container, clone);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (options.skipForbiddenKeys && FORBIDDEN_KEYS.has(k)) {
        continue;
      }

      const override = options.handleKey?.(k, v);
      if (override?.handled) {
        if (override.value !== v) {
          modified = true;
        }
        clone[k] = override.value;
        continue;
      }

      clone[k] = walk(v, depth + 1);
    }
    return clone;
  }

  const value = walk(root, 0);
  return { value, modified, depthExceeded };
}
