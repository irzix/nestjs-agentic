import type { JsonSchema } from '../interfaces/structured-output.interface';

export interface JsonSchemaValidationResult {
  valid: boolean;
  /** One line per violation, each prefixed with a JSON path such as `$.items[0].price`. */
  issues: string[];
}

export interface JsonSchemaValidationOptions {
  /** Stops collecting after this many issues. Default: `20`. */
  maxIssues?: number;
}

/** Guards against `$ref` cycles that never consume input. */
const MAX_DEPTH = 64;

type SchemaNode = JsonSchema | boolean;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** Resolves a local JSON Pointer reference such as `#/$defs/address`. */
function resolveRef(root: JsonSchema, ref: string): SchemaNode | undefined {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null || !(segment in node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'boolean' || (typeof node === 'object' && node !== null)
    ? (node as SchemaNode)
    : undefined;
}

/**
 * Validates a value against a JSON Schema, without dependencies.
 *
 * Covers the subset that provider structured-output modes use, plus common
 * constraints: `type` (one or several, `integer` included), `enum`, `const`,
 * `properties`, `required`, `additionalProperties`, `minProperties`,
 * `maxProperties`, `items`, `prefixItems`, `minItems`, `maxItems`,
 * `uniqueItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`,
 * `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `anyOf`, `oneOf`,
 * `allOf`, `not`, boolean schemas, and local `$ref`s into `$defs` or
 * `definitions`. Other keywords, `format` included, are ignored rather than
 * rejected. For full JSON Schema coverage, plug a validator such as Ajv into
 * `StructuredOutputOptions.validate`.
 */
export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  options: JsonSchemaValidationOptions = {},
): JsonSchemaValidationResult {
  const maxIssues = options.maxIssues ?? 20;
  const issues: string[] = [];

  const report = (path: string, message: string): void => {
    if (issues.length < maxIssues) issues.push(`${path}: ${message}`);
  };

  /** Runs `node` against `instance` into a scratch list, for anyOf/oneOf/not. */
  const probe = (instance: unknown, node: SchemaNode, path: string, depth: number): string[] => {
    const saved = issues.splice(0, issues.length);
    walk(instance, node, path, depth);
    const found = issues.splice(0, issues.length);
    issues.push(...saved);
    return found;
  };

  function walk(instance: unknown, node: SchemaNode, path: string, depth: number): void {
    if (issues.length >= maxIssues) return;
    if (depth > MAX_DEPTH) {
      report(path, 'schema nesting is too deep (possible $ref cycle)');
      return;
    }
    if (node === true) return;
    if (node === false) {
      report(path, 'no value is allowed here');
      return;
    }

    const s = node as Record<string, unknown>;

    if (typeof s.$ref === 'string') {
      const target = resolveRef(schema, s.$ref);
      if (target === undefined) {
        report(path, `unresolvable $ref "${s.$ref}"`);
        return;
      }
      walk(instance, target, path, depth + 1);
    }

    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((type) => matchesType(instance, type))) {
        report(path, `expected ${types.join(' or ')}, received ${typeOf(instance)}`);
        return;
      }
    }

    if (Array.isArray(s.enum) && !s.enum.some((option) => deepEqual(option, instance))) {
      report(path, `must be one of ${JSON.stringify(s.enum)}`);
    }
    if ('const' in s && !deepEqual(s.const, instance)) {
      report(path, `must equal ${JSON.stringify(s.const)}`);
    }

    if (typeof instance === 'string') {
      if (typeof s.minLength === 'number' && instance.length < s.minLength) {
        report(path, `must be at least ${s.minLength} characters`);
      }
      if (typeof s.maxLength === 'number' && instance.length > s.maxLength) {
        report(path, `must be at most ${s.maxLength} characters`);
      }
      if (typeof s.pattern === 'string') {
        let matches = true;
        try {
          matches = new RegExp(s.pattern, 'u').test(instance);
        } catch {
          report(path, `schema pattern ${JSON.stringify(s.pattern)} is not a valid regular expression`);
        }
        if (!matches) report(path, `must match pattern ${JSON.stringify(s.pattern)}`);
      }
    }

    if (typeof instance === 'number') {
      if (typeof s.minimum === 'number' && instance < s.minimum) report(path, `must be >= ${s.minimum}`);
      if (typeof s.maximum === 'number' && instance > s.maximum) report(path, `must be <= ${s.maximum}`);
      if (typeof s.exclusiveMinimum === 'number' && instance <= s.exclusiveMinimum) {
        report(path, `must be > ${s.exclusiveMinimum}`);
      }
      if (typeof s.exclusiveMaximum === 'number' && instance >= s.exclusiveMaximum) {
        report(path, `must be < ${s.exclusiveMaximum}`);
      }
      if (typeof s.multipleOf === 'number' && s.multipleOf > 0) {
        const quotient = instance / s.multipleOf;
        if (Math.abs(quotient - Math.round(quotient)) > 1e-9) report(path, `must be a multiple of ${s.multipleOf}`);
      }
    }

    if (Array.isArray(instance)) {
      if (typeof s.minItems === 'number' && instance.length < s.minItems) {
        report(path, `must have at least ${s.minItems} items`);
      }
      if (typeof s.maxItems === 'number' && instance.length > s.maxItems) {
        report(path, `must have at most ${s.maxItems} items`);
      }
      if (s.uniqueItems === true) {
        const duplicate = instance.findIndex((item, i) => instance.findIndex((other) => deepEqual(item, other)) !== i);
        if (duplicate !== -1) report(childPath(path, duplicate), 'duplicates an earlier item');
      }
      const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as SchemaNode[]) : [];
      instance.forEach((item, i) => {
        if (i < prefix.length) {
          walk(item, prefix[i], childPath(path, i), depth + 1);
        } else if (s.items !== undefined && !Array.isArray(s.items)) {
          walk(item, s.items as SchemaNode, childPath(path, i), depth + 1);
        }
      });
    }

    if (typeOf(instance) === 'object') {
      const record = instance as Record<string, unknown>;
      const keys = Object.keys(record);
      const properties = (s.properties ?? {}) as Record<string, SchemaNode>;

      if (Array.isArray(s.required)) {
        for (const key of s.required as string[]) {
          if (!Object.prototype.hasOwnProperty.call(record, key)) {
            report(childPath(path, key), 'is required');
          }
        }
      }
      if (typeof s.minProperties === 'number' && keys.length < s.minProperties) {
        report(path, `must have at least ${s.minProperties} properties`);
      }
      if (typeof s.maxProperties === 'number' && keys.length > s.maxProperties) {
        report(path, `must have at most ${s.maxProperties} properties`);
      }
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          walk(record[key], properties[key], childPath(path, key), depth + 1);
        } else if (s.additionalProperties === false) {
          report(childPath(path, key), 'is not an allowed property');
        } else if (typeof s.additionalProperties === 'object' && s.additionalProperties !== null) {
          walk(record[key], s.additionalProperties as SchemaNode, childPath(path, key), depth + 1);
        }
      }
    }

    if (Array.isArray(s.allOf)) {
      for (const sub of s.allOf as SchemaNode[]) walk(instance, sub, path, depth + 1);
    }
    if (Array.isArray(s.anyOf)) {
      const branches = (s.anyOf as SchemaNode[]).map((sub) => probe(instance, sub, path, depth + 1));
      if (!branches.some((found) => found.length === 0)) {
        report(path, `must match at least one schema in anyOf (${summarize(branches)})`);
      }
    }
    if (Array.isArray(s.oneOf)) {
      const branches = (s.oneOf as SchemaNode[]).map((sub) => probe(instance, sub, path, depth + 1));
      const matched = branches.filter((found) => found.length === 0).length;
      if (matched !== 1) {
        report(
          path,
          matched === 0
            ? `must match exactly one schema in oneOf (${summarize(branches)})`
            : `must match exactly one schema in oneOf, but matched ${matched}`,
        );
      }
    }
    if (s.not !== undefined && probe(instance, s.not as SchemaNode, path, depth + 1).length === 0) {
      report(path, 'must not match the schema in "not"');
    }
  }

  walk(value, schema, '$', 0);
  return { valid: issues.length === 0, issues };
}

/** The first issue of each failed branch, so a combinator error stays readable. */
function summarize(branches: string[][]): string {
  return branches.map((found, i) => `#${i}: ${found[0] ?? 'ok'}`).join('; ');
}
