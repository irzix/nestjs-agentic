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
   * When `false`, non-plain objects (`Date`, `Map`, `Set`, class instances, etc.) are
   * cloned into a plain `{}`/`[]`, which corrupts their semantics (an empty object in
   * place of a `Date`). Set to `false` only if a caller specifically needs the legacy
   * clone-everything behavior.
   * Default: `true` (non-plain values are returned unchanged).
   */
  preserveNonPlainObjects?: boolean;

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
  const preserveNonPlainObjects = options.preserveNonPlainObjects ?? true;
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

    const isArray = Array.isArray(value);
    if (!isArray && preserveNonPlainObjects && !isPlainRecord(value)) {
      // Non-plain object (Date, Map, Set, class instance, etc): returned unchanged
      // to preserve its semantics rather than being cloned into a plain {}.
      return value;
    }

    if (seenMap.has(value)) {
      return seenMap.get(value);
    }

    if (isArray) {
      const clone: unknown[] = [];
      seenMap.set(value, clone);
      for (const item of value) {
        clone.push(walk(item, depth + 1));
      }
      return clone;
    }

    // Cloning into a null-prototype container means an own `__proto__` key on the
    // source object can never mutate a real prototype chain, regardless of
    // `skipForbiddenKeys` — a defense-in-depth floor under the opt-out.
    const clone: Record<string, unknown> = Object.create(null);
    seenMap.set(value, clone);
    for (const [k, v] of Object.entries(value)) {
      if (skipForbiddenKeys && FORBIDDEN_KEYS.has(k)) {
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
