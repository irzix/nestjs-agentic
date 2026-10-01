import type {
  JsonSchema,
  StructuredOutputOptions,
  StructuredOutputSpec,
  StructuredOutputValidation,
} from '../interfaces/structured-output.interface';
import type { ModelOutputFormat } from '../interfaces/model.interface';
import { validateJsonSchema } from './json-schema.validator';

const DEFAULT_NAME = 'response';
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
/** Upper bound on issues echoed back to the model in a repair prompt. */
const MAX_REPAIR_ISSUES = 10;

/**
 * Combines an `outputSchema` with its options, run-level values taking
 * precedence over agent-level ones. Returns `undefined` when no schema is set.
 */
export function resolveStructuredOutput(
  layers: Array<{ outputSchema?: JsonSchema; structuredOutput?: StructuredOutputOptions } | undefined>,
): StructuredOutputSpec | undefined {
  let schema: JsonSchema | undefined;
  let options: StructuredOutputOptions = {};
  // Later layers win, so callers pass [agent, run].
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.outputSchema !== undefined) schema = layer.outputSchema;
    if (layer.structuredOutput) options = { ...options, ...layer.structuredOutput };
  }
  if (schema === undefined) return undefined;

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new TypeError('outputSchema must be a JSON Schema object.');
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

/**
 * Parses a final answer as JSON. Tolerates what models commonly wrap around
 * it: surrounding whitespace, a Markdown code fence, or a sentence before or
 * after a single JSON object or array.
 */
export function parseJsonAnswer(content: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  const candidates: string[] = [];
  const trimmed = content.trim();
  candidates.push(trimmed);

  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());

  const start = trimmed.search(/[[{]/);
  if (start !== -1) {
    const close = trimmed[start] === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) candidates.push(trimmed.slice(start, end + 1));
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
    return verdict.valid || verdict.issues.length > 0
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
