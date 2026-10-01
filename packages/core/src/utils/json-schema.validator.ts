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

/** `$ref`s followed in a row without moving into the value: past this, it is a cycle. */
const MAX_REF_CHAIN = 32;
/** Nesting of the value itself, a guard against stack exhaustion. */
const MAX_VALUE_DEPTH = 256;

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

const compiledPatterns = new Map<string, RegExp | null>();

/**
 * Compiles a schema `pattern`. JSON Schema patterns are ECMA-262 regular
 * expressions; the Unicode flag is tried first, and patterns that are only
 * valid without it (such as `[\w-.]`) are compiled without it. Returns `null`
 * for a pattern that is invalid either way.
 */
function compilePattern(pattern: string): RegExp | null {
  let compiled = compiledPatterns.get(pattern);
  if (compiled === undefined) {
    try {
      compiled = new RegExp(pattern, 'u');
    } catch {
      try {
        compiled = new RegExp(pattern);
      } catch {
        compiled = null;
      }
    }
    compiledPatterns.set(pattern, compiled);
  }
  return compiled;
}

/**
 * Problems in a schema itself, which no answer could fix: patterns that are
 * not valid regular expressions and `$ref`s that do not resolve locally.
 * Empty when the schema is usable.
 */
export function findSchemaProblems(schema: JsonSchema): string[] {
  const problems: string[] = [];
  const seen = new Set<object>();

  const visit = (node: unknown, at: string): void => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${at}/${i}`));
      return;
    }
    const s = node as Record<string, unknown>;
    if (typeof s.pattern === 'string' && compilePattern(s.pattern) === null) {
      problems.push(`${at || '/'}: pattern ${JSON.stringify(s.pattern)} is not a valid regular expression`);
    }
    if (typeof s.$ref === 'string' && resolveRef(schema, s.$ref) === undefined) {
      problems.push(`${at || '/'}: $ref "${s.$ref}" does not resolve within the schema`);
    }
    if (typeof s.patternProperties === 'object' && s.patternProperties !== null) {
      for (const key of Object.keys(s.patternProperties)) {
        if (compilePattern(key) === null) {
          problems.push(`${at || '/'}: patternProperties key ${JSON.stringify(key)} is not a valid regular expression`);
        }
      }
    }
    for (const [key, value] of Object.entries(s)) {
      // `const`, `enum`, and `default` hold data, not subschemas.
      if (key === 'const' || key === 'enum' || key === 'default' || key === 'examples') continue;
      visit(value, `${at}/${key}`);
    }
  };

  visit(schema, '');
  return problems;
}

/**
 * Validates a value against a JSON Schema, without dependencies.
 *
 * Covers the subset that provider structured-output modes use, plus common
 * constraints: `type` (one or several, `integer` included), `nullable`
 * (OpenAPI), `enum`, `const`, `properties`, `patternProperties`, `required`,
 * `additionalProperties`, `minProperties`, `maxProperties`, `items` (a schema,
 * or a draft-07 tuple with `additionalItems`), `prefixItems`, `minItems`,
 * `maxItems`, `uniqueItems`, `minLength`, `maxLength` (counted in code
 * points), `pattern`, `minimum`, `maximum`, `exclusiveMinimum`,
 * `exclusiveMaximum`, `multipleOf`, `anyOf`, `oneOf`, `allOf`, `not`, boolean
 * schemas, and local `$ref`s into `$defs` or `definitions`. Other keywords,
 * `format` included, are ignored rather than rejected. For full JSON Schema
 * coverage, plug a validator such as Ajv into `StructuredOutputOptions.validate`.
 *
 * Problems in the schema itself are reported by `findSchemaProblems`.
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
  const probe = (instance: unknown, node: SchemaNode, path: string, depth: number, refChain: number): string[] => {
    const saved = issues.splice(0, issues.length);
    walk(instance, node, path, depth, refChain);
    const found = issues.splice(0, issues.length);
    issues.push(...saved);
    return found;
  };

  /**
   * @param depth How deep `instance` is nested in the value.
   * @param refChain `$ref`s followed at this same position without moving
   *   into the value; only a chain that never consumes input can loop.
   */
  function walk(instance: unknown, node: SchemaNode, path: string, depth: number, refChain: number): void {
    if (issues.length >= maxIssues) return;
    if (depth > MAX_VALUE_DEPTH) {
      report(path, `the value is nested more than ${MAX_VALUE_DEPTH} levels deep`);
      return;
    }
    if (node === true) return;
    if (node === false) {
      report(path, 'no value is allowed here');
      return;
    }

    const s = node as Record<string, unknown>;
    const into = (child: unknown, sub: SchemaNode, at: string): void => walk(child, sub, at, depth + 1, 0);
    const here = (sub: SchemaNode): void => walk(instance, sub, path, depth, refChain);

    if (typeof s.$ref === 'string') {
      const target = resolveRef(schema, s.$ref);
      if (target === undefined) {
        report(path, `unresolvable $ref "${s.$ref}"`);
        return;
      }
      if (refChain >= MAX_REF_CHAIN) {
        report(path, `$ref "${s.$ref}" loops without matching any value`);
        return;
      }
      walk(instance, target, path, depth, refChain + 1);
    }

    if (instance === null && s.nullable === true) return;

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
      // JSON Schema counts characters as code points, so an emoji is one.
      const length = Array.from(instance).length;
      if (typeof s.minLength === 'number' && length < s.minLength) {
        report(path, `must be at least ${s.minLength} characters`);
      }
      if (typeof s.maxLength === 'number' && length > s.maxLength) {
        report(path, `must be at most ${s.maxLength} characters`);
      }
      if (typeof s.pattern === 'string') {
        const regex = compilePattern(s.pattern);
        // An invalid pattern is a schema problem (see findSchemaProblems), not the answer's.
        if (regex && !regex.test(instance)) report(path, `must match pattern ${JSON.stringify(s.pattern)}`);
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
      // Draft 2020-12 `prefixItems` + `items`, or the draft-07 tuple form,
      // `items: [...]` + `additionalItems`.
      const tuple = Array.isArray(s.prefixItems)
        ? (s.prefixItems as SchemaNode[])
        : Array.isArray(s.items)
          ? (s.items as SchemaNode[])
          : [];
      const rest = Array.isArray(s.prefixItems)
        ? (s.items as SchemaNode | undefined)
        : Array.isArray(s.items)
          ? (s.additionalItems as SchemaNode | undefined)
          : (s.items as SchemaNode | undefined);
      instance.forEach((item, i) => {
        if (i < tuple.length) into(item, tuple[i], childPath(path, i));
        else if (rest !== undefined) into(item, rest, childPath(path, i));
      });
    }

    if (typeOf(instance) === 'object') {
      const record = instance as Record<string, unknown>;
      const keys = Object.keys(record);
      const properties = (s.properties ?? {}) as Record<string, SchemaNode>;
      const patternProperties = Object.entries((s.patternProperties ?? {}) as Record<string, SchemaNode>)
        .map(([pattern, sub]) => [compilePattern(pattern), sub] as const)
        .filter((entry): entry is readonly [RegExp, SchemaNode] => entry[0] !== null);

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
        const at = childPath(path, key);
        let matched = false;
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          into(record[key], properties[key], at);
          matched = true;
        }
        for (const [regex, sub] of patternProperties) {
          if (regex.test(key)) {
            into(record[key], sub, at);
            matched = true;
          }
        }
        if (matched) continue;
        if (s.additionalProperties === false) {
          report(at, 'is not an allowed property');
        } else if (typeof s.additionalProperties === 'object' && s.additionalProperties !== null) {
          into(record[key], s.additionalProperties as SchemaNode, at);
        }
      }
    }

    if (Array.isArray(s.allOf)) {
      for (const sub of s.allOf as SchemaNode[]) here(sub);
    }
    if (Array.isArray(s.anyOf)) {
      const branches = (s.anyOf as SchemaNode[]).map((sub) => probe(instance, sub, path, depth, refChain));
      if (!branches.some((found) => found.length === 0)) {
        report(path, `must match at least one schema in anyOf (${summarize(branches)})`);
      }
    }
    if (Array.isArray(s.oneOf)) {
      const branches = (s.oneOf as SchemaNode[]).map((sub) => probe(instance, sub, path, depth, refChain));
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
    if (s.not !== undefined && probe(instance, s.not as SchemaNode, path, depth, refChain).length === 0) {
      report(path, 'must not match the schema in "not"');
    }
  }

  walk(value, schema, '$', 0, 0);
  return { valid: issues.length === 0, issues };
}

/** The first issue of each failed branch, so a combinator error stays readable. */
function summarize(branches: string[][]): string {
  return branches.map((found, i) => `#${i}: ${found[0] ?? 'ok'}`).join('; ');
}
