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

  /**
   * Whether redaction caused two distinct `Map` keys or `Set` members to collapse into
   * one, which would silently drop an entry. Callers should fail closed rather than
   * return a container that lost data.
   */
  keyCollision: boolean;

  /**
   * Whether sensitive content was found inside a value that cannot be safely rebuilt
   * (a class instance or platform built-in such as `URL`, `Error`, `Buffer`, or a typed
   * array — copying enumerable properties onto a fresh prototype would not initialize
   * their internal slots, and assigning could trigger inherited setters).
   *
   * Such values are left untouched and this flag is raised instead, so callers fail
   * closed rather than emitting either unredacted data or a structurally broken clone.
   */
  unredactable: boolean;
}

/**
 * Recursively walks a value, redacting string leaves via `transformString` (and, optionally,
 * whole keyed properties via `handleKey`). Shared by `SecretRedactionPolicy`,
 * `PiiRedactionPolicy`, and any policy needing safe, circular-reference-aware tree traversal
 * over untrusted tool output.
 *
 * The supported boundary is explicit rather than best-effort:
 *
 * - **Rebuilt and redacted**: strings, arrays, plain records, `Map`, `Set`. These have
 *   well-defined reconstruction semantics, so redacted copies are safe to return.
 * - **Preserved as-is**: `Date` and `RegExp` (opaque value types holding no redactable
 *   string content), and clean class instances / built-ins.
 * - **Detect-and-deny**: class instances and platform built-ins are *inspected* (including
 *   symbol-keyed properties) but never rewritten, since copying their enumerable properties
 *   onto a fresh prototype cannot restore internal slots and would risk invoking inherited
 *   setters. If sensitive content is found in one, `unredactable` is raised so the caller
 *   can refuse the output.
 *
 * @param root The (untrusted) value to traverse — typically a tool's raw output.
 * @param options Traversal configuration; see `RedactionTraversalOptions`.
 * @returns The (possibly cloned/redacted) value plus flags describing whether anything was
 *   modified, whether depth was exceeded, whether redaction collapsed container entries,
 *   and whether sensitive data was found somewhere it could not be safely rewritten.
 */
export function traverseAndRedact(
  root: unknown,
  options: RedactionTraversalOptions,
): RedactionTraversalResult {
  let modified = false;
  let depthExceeded = false;
  let keyCollision = false;
  let unredactable = false;
  const seenMap = new WeakMap<object, unknown>();
  const onDepthExceeded = options.onDepthExceeded ?? 'passthrough';
  const skipForbiddenKeys = options.skipForbiddenKeys ?? true;

  /**
   * Reports whether `transformString` would alter any string reachable from `value`,
   * without rebuilding it. Used for values that must not be rewritten (class instances,
   * built-ins) so sensitive content can still be detected and denied.
   *
   * Uses `Reflect.ownKeys` so symbol-keyed properties are inspected too.
   */
  function containsSensitive(value: unknown, depth: number, seen: WeakSet<object>): boolean {
    if (depth > options.maxDepth) {
      if (onDepthExceeded === 'deny') depthExceeded = true;
      return false;
    }

    if (typeof value === 'string') {
      return options.transformString(value) !== value;
    }

    if (typeof value !== 'object' || value === null) return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (value instanceof Date || value instanceof RegExp) return false;

    // Values whose data lives in internal slots (URL, and other `toJSON()` providers)
    // expose nothing via own keys, yet `JSON.stringify` — which is how tool output
    // reaches the model — emits their serialized form. Inspect that form so their
    // content can't bypass detection.
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      let serialized: unknown;
      try {
        serialized = (toJson as () => unknown).call(value);
      } catch {
        // A throwing toJSON() tells us nothing; fall through to the own-key walk.
        serialized = undefined;
      }
      if (serialized !== undefined && serialized !== value && containsSensitive(serialized, depth + 1, seen)) {
        return true;
      }
    }

    if (value instanceof Map) {
      for (const [k, v] of value) {
        if (containsSensitive(k, depth + 1, seen) || containsSensitive(v, depth + 1, seen)) return true;
      }
      return false;
    }

    if (value instanceof Set || Array.isArray(value)) {
      for (const member of value) {
        if (containsSensitive(member, depth + 1, seen)) return true;
      }
      return false;
    }

    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Only inspect plain data properties: reading a getter could execute
      // application code during sanitization.
      if (!descriptor || !('value' in descriptor)) continue;
      if (containsSensitive(descriptor.value, depth + 1, seen)) return true;
    }
    return false;
  }

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

    // Opaque value types: no redactable string content, and reconstructing them from
    // enumerable properties would lose their internal state.
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

    if (value instanceof Map) {
      const clone = new Map<unknown, unknown>();
      seenMap.set(value, clone);
      for (const [k, v] of value) {
        // String keys are redacted, so PII/secrets in a key can't leak. Non-string keys
        // are preserved by reference so reference-based `Map.get` lookups keep working;
        // if such a key holds sensitive data it can't be rewritten without breaking
        // identity, so it's reported as unredactable instead of silently passed.
        let newKey: unknown = k;
        if (typeof k === 'string') {
          const transformedKey = options.transformString(k);
          if (transformedKey !== k) {
            modified = true;
          }
          newKey = transformedKey;
        } else if (containsSensitive(k, depth + 1, new WeakSet<object>())) {
          unredactable = true;
        }

        // Checked before *every* insertion, regardless of whether this key changed:
        // a transformed key can collide with a later untransformed one (and vice
        // versa), and either order would silently overwrite an entry.
        if (clone.has(newKey)) {
          keyCollision = true;
        }
        clone.set(newKey, walk(v, depth + 1));
      }
      return clone;
    }

    if (value instanceof Set) {
      const clone = new Set<unknown>();
      seenMap.set(value, clone);
      for (const member of value) {
        const redacted = walk(member, depth + 1);
        // Two distinct members redacting to the same value would collapse silently.
        if (clone.has(redacted)) {
          keyCollision = true;
        }
        clone.add(redacted);
      }
      return clone;
    }

    // Class instances and platform built-ins (URL, Error, Buffer, typed arrays, ...).
    // These cannot be faithfully rebuilt by copying enumerable properties onto a fresh
    // prototype — internal slots would be missing and assignment could trigger
    // inherited setters — so they are inspected but never rewritten.
    if (!isPlainRecord(value)) {
      if (containsSensitive(value, depth, new WeakSet<object>())) {
        unredactable = true;
      }
      return value;
    }

    // Plain records clone into a null-prototype container so an own `__proto__` key on
    // untrusted input can never mutate a real prototype chain.
    const clone: Record<string, unknown> = Object.create(null);
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
  return { value, modified, depthExceeded, keyCollision, unredactable };
}
