import type {
  JsonSchema,
  StoredStructuredOutput,
  StructuredOutputOptions,
  StructuredOutputSpec,
  StructuredOutputValidation,
} from '../interfaces/structured-output.interface';
import type { ModelOutputFormat } from '../interfaces/model.interface';
import { InvalidOutputSchemaError } from '../errors';
import { canonicalize } from '../audit/hash-chain-audit.sink';
import { findSchemaProblems, validateJsonSchema } from './json-schema.validator';

const DEFAULT_NAME = 'response';
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
/** Upper bound on issues echoed back to the model in a repair prompt. */
const MAX_REPAIR_ISSUES = 10;

/** Schemas already checked by `resolveStructuredOutput`. */
const checkedSchemas = new WeakSet<object>();

/**
 * Combines an `outputSchema` with its options. Later layers win, so callers
 * pass `[agent, run]`. A layer that sets its own `outputSchema` starts its
 * options afresh, since options such as `validate` belong to the schema they
 * were written for; a layer that only sets options adjusts the schema it
 * inherits. Returns `undefined` when no schema is set.
 *
 * Throws `InvalidOutputSchemaError` for a schema no answer could satisfy
 * (an invalid pattern, an unresolvable `$ref`), before any model is called.
 */
export function resolveStructuredOutput(
  layers: Array<{ outputSchema?: JsonSchema; structuredOutput?: StructuredOutputOptions } | undefined>,
): StructuredOutputSpec | undefined {
  let schema: JsonSchema | undefined;
  let options: StructuredOutputOptions = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.outputSchema !== undefined) {
      schema = layer.outputSchema;
      options = { ...layer.structuredOutput };
    } else if (layer.structuredOutput) {
      options = { ...options, ...layer.structuredOutput };
    }
  }
  if (schema === undefined) return undefined;

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new TypeError('outputSchema must be a JSON Schema object.');
  }
  if (!checkedSchemas.has(schema)) {
    const problems = findSchemaProblems(schema);
    if (problems.length > 0) throw new InvalidOutputSchemaError(problems);
    checkedSchemas.add(schema);
  }
  const attempts = options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  if (!(Number.isInteger(attempts) && attempts >= 0)) {
    throw new TypeError(`structuredOutput.maxRepairAttempts must be a non-negative integer, received ${attempts}.`);
  }
  return { ...options, schema, maxRepairAttempts: attempts };
}

/** Repair attempts a spec allows, applying the default. */
export function maxRepairAttemptsOf(spec: StructuredOutputSpec): number {
  return spec.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
}

/** The provider-facing request for a spec. */
export function toOutputFormat(spec: StructuredOutputSpec): ModelOutputFormat {
  return {
    type: 'json_schema',
    name: spec.name ?? DEFAULT_NAME,
    schema: spec.schema,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    strict: spec.strict ?? false,
  };
}

/** Openings tried when extracting JSON from prose, a bound on the work. */
const MAX_EXTRACTION_ATTEMPTS = 20;

/**
 * The balanced `{…}` or `[…]` starting at `start`, skipping brackets inside
 * strings, or `undefined` if it never closes.
 */
function balancedAt(text: string, start: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return undefined;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Parses a final answer as JSON. Tolerates what models commonly wrap around
 * it: surrounding whitespace, a Markdown code fence, or prose before or after
 * the JSON object or array, brackets in that prose included.
 */
export function parseJsonAnswer(content: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  const candidates: string[] = [];
  const trimmed = content.trim();
  candidates.push(trimmed);

  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());

  let attempts = 0;
  for (let i = 0; i < trimmed.length && attempts < MAX_EXTRACTION_ATTEMPTS; i++) {
    if (trimmed[i] !== '{' && trimmed[i] !== '[') continue;
    attempts++;
    const candidate = balancedAt(trimmed, i);
    if (candidate) candidates.push(candidate);
  }

  let lastError = 'the answer is empty';
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, issue: `$: the answer is not valid JSON (${lastError})` };
}

/** Parses and validates a final answer against a spec. */
export async function checkStructuredOutput(
  spec: StructuredOutputSpec,
  content: string,
): Promise<StructuredOutputValidation> {
  const parsed = parseJsonAnswer(content);
  if (!parsed.ok) return { valid: false, issues: [parsed.issue] };

  if (spec.validate) {
    const verdict = await spec.validate(parsed.value);
    if (verdict.valid) return verdict;
    // A validator that rejects without saying why still gives the model something.
    return Array.isArray(verdict.issues) && verdict.issues.length > 0
      ? verdict
      : { valid: false, issues: ['$: rejected by the custom validator'] };
  }

  const result = validateJsonSchema(parsed.value, spec.schema);
  return result.valid ? { valid: true, value: parsed.value } : { valid: false, issues: result.issues };
}

/**
 * Describes the schema to a model whose adapter cannot enforce it natively.
 * Sent with the request only, never stored in the transcript.
 */
export function structuredOutputInstruction(spec: StructuredOutputSpec): string {
  return [
    'When you give your final answer, reply with only a JSON value that conforms to the JSON Schema below, with no other text.',
    JSON.stringify(spec.schema),
  ].join('\n');
}

/** Asks the model to correct a non-conforming final answer. */
export function repairPrompt(issues: string[]): string {
  const listed = issues.slice(0, MAX_REPAIR_ISSUES).map((issue) => `- ${issue}`);
  if (issues.length > MAX_REPAIR_ISSUES) listed.push(`- …and ${issues.length - MAX_REPAIR_ISSUES} more`);
  return [
    'Your previous answer did not match the required JSON Schema:',
    ...listed,
    'Reply again with only a JSON value that satisfies the schema, with no other text.',
  ].join('\n');
}

/** The part of a spec that survives storage: everything but `validate`. */
export function toStoredStructuredOutput(spec: StructuredOutputSpec | undefined): StoredStructuredOutput | undefined {
  if (!spec) return undefined;
  const { validate: _validate, ...stored } = spec;
  return stored;
}

/**
 * The spec a resumed or recovered turn runs under. The agent's own spec wins
 * when it has the same schema, keeping its `validate`; a schema the original
 * run set itself comes from storage and is checked by the built-in
 * validator, since a function cannot be stored.
 */
export function restoreStructuredOutput(
  stored: StoredStructuredOutput | undefined,
  agentSpec: StructuredOutputSpec | undefined,
): StructuredOutputSpec | undefined {
  if (!stored) return agentSpec;
  if (agentSpec && canonicalize(agentSpec.schema) === canonicalize(stored.schema)) return agentSpec;
  return { ...stored };
}
