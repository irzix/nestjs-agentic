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

/** What a traversal does when a value is nested deeper than `maxDepth`. */
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
   * When `false`, prototype-polluting keys (`__proto__`, `prototype`, `constructor`)
   * are cloned like any other key, which can mutate the sanitized clone's prototype
   * chain from untrusted input. Set to `false` only for trusted input where these keys
   * carry meaningful data.
   * Default: `true` (forbidden keys are skipped during cloning).
   */
  skipForbiddenKeys?: boolean;
}

export interface RedactionTraversalResult {
  /** The (possibly cloned and redacted) value. */
  value: unknown;
  /** Whether any string, keyed value, or dropped forbidden key changed the output. */
  modified: boolean;
  /** Whether a value nested deeper than `maxDepth` was encountered (only when `onDepthExceeded: 'deny'`). */
  depthExceeded: boolean;
}

/**
 * Recursively walks a value, redacting string leaves via `transformString` (and, optionally,
 * whole keyed properties via `handleKey`). Shared by `SecretRedactionPolicy`,
 * `PiiRedactionPolicy`, and any policy needing safe, circular-reference-aware tree traversal
 * over untrusted tool output.
 *
 * @param root The (untrusted) value to traverse — typically a tool's raw output.
 * @param options Traversal configuration; see `RedactionTraversalOptions`.
 * @returns The (possibly cloned/redacted) value, whether anything was modified, and
 *   whether traversal encountered a structure deeper than `maxDepth`.
 */
export function traverseAndRedact(
  root: unknown,
  options: RedactionTraversalOptions,
): RedactionTraversalResult {
  let modified = false;
  let depthExceeded = false;
  const seenMap = new WeakMap<object, unknown>();
  const onDepthExceeded = options.onDepthExceeded ?? 'passthrough';
  const skipForbiddenKeys = options.skipForbiddenKeys ?? true;

  function walk(value: unknown, depth: number): unknown {
    // Checked unconditionally at entry, for every type: nodes at depth <= maxDepth
    // are inspected, nodes strictly deeper are returned unchanged. A string leaf at
    // this depth is just as unsafe to skip as an unexamined object/array, so the
    // gate applies uniformly rather than only to containers.
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

    if (seenMap.has(value)) {
      return seenMap.get(value);
    }

    // Value-like objects with internal slots that can't be reconstructed by copying
    // enumerable properties, and that carry no redactable string content. Preserved
    // as-is so their semantics survive sanitization.
    if (value instanceof Date || value instanceof RegExp) {
      return value;
    }

    if (Array.isArray(value)) {
      const clone: unknown[] = [];
      seenMap.set(value, clone);
      for (const item of value) {
        clone.push(walk(item, depth + 1));
      }
      return clone;
    }

    // Map/Set are rebuilt with their type preserved AND their contents inspected,
    // so PII/secrets held inside them can't slip through unredacted. Both keys and
    // values are recursed — a key can itself be PII-bearing. In the common case a
    // key carries no sensitive pattern and is returned unchanged, so lookups still
    // work; only a key that actually matches a redaction rule is rewritten.
    if (value instanceof Map) {
      const clone = new Map<unknown, unknown>();
      seenMap.set(value, clone);
      for (const [k, v] of value) {
        clone.set(walk(k, depth + 1), walk(v, depth + 1));
      }
      return clone;
    }

    if (value instanceof Set) {
      const clone = new Set<unknown>();
      seenMap.set(value, clone);
      for (const member of value) {
        clone.add(walk(member, depth + 1));
      }
      return clone;
    }

    // Plain records clone into a null-prototype container so an own `__proto__` key on
    // untrusted input can never mutate a real prototype chain. Class instances clone
    // onto their original prototype, so `instanceof` and methods survive while their
    // enumerable string fields are still inspected and redacted.
    const plain = isPlainRecord(value);
    const clone: Record<string, unknown> = plain
      ? Object.create(null)
      : Object.create(Object.getPrototypeOf(value));
    seenMap.set(value, clone);
    for (const [k, v] of Object.entries(value)) {
      if (skipForbiddenKeys && FORBIDDEN_KEYS.has(k)) {
        // Dropping the key changes the output, so the caller must treat this as a
        // modification — otherwise a result whose only unsafe content sits under a
        // forbidden key would be reported unchanged and the original forwarded.
        modified = true;
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
