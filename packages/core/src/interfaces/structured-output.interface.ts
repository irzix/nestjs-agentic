/**
 * A JSON Schema document describing the shape of an agent's final answer.
 *
 * Kept as a plain object so any producer works: hand-written schemas,
 * `zod-to-json-schema`, TypeBox, or class-validator converters.
 */
export type JsonSchema = { [keyword: string]: unknown };

/** Outcome of validating a parsed final answer. */
export type StructuredOutputValidation<T = unknown> =
  | { valid: true; value: T }
  | { valid: false; issues: string[] };

/**
 * Tuning for structured output. Only takes effect together with an
 * `outputSchema`.
 */
export interface StructuredOutputOptions<T = unknown> {
  /**
   * Name sent to providers that require one, such as OpenAI's
   * `response_format.json_schema.name`. Default: `'response'`.
   */
  name?: string;
  /** Description sent to providers that accept one. */
  description?: string;
  /**
   * Ask the provider for strict, schema-constrained decoding where supported.
   * Strict modes accept only a subset of JSON Schema (OpenAI requires every
   * property to be `required` and `additionalProperties: false`), so this is
   * off by default; the OpenAI adapter sends a schema outside that subset
   * non-strict rather than have the request rejected. The answer is
   * validated either way.
   *
   * Default: `false`
   */
  strict?: boolean;
  /**
   * How many times the model is re-prompted with the validation issues after a
   * non-conforming answer, before the turn fails with `StructuredOutputError`.
   * Each attempt is a model round and counts against the execution budgets.
   * `0` disables repair.
   *
   * Default: `2`
   */
  maxRepairAttempts?: number;
  /**
   * Replaces the built-in validator, for example with Ajv or a zod schema's
   * `safeParse`. Receives the parsed JSON and returns the value to expose on
   * `AgentResult.structured`, or the issues to send back to the model.
   */
  validate?(value: unknown): StructuredOutputValidation<T> | Promise<StructuredOutputValidation<T>>;
}

/** An `outputSchema` together with its options, resolved for one turn. */
export interface StructuredOutputSpec<T = unknown> extends StructuredOutputOptions<T> {
  schema: JsonSchema;
}

/**
 * A spec as stored on an approval or in-flight checkpoint, so a resumed turn
 * keeps the schema the run asked for. `validate` cannot be stored.
 */
export type StoredStructuredOutput = Omit<StructuredOutputSpec, 'validate'>;
