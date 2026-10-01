---
"@nestjs-agentic/core": minor
"@nestjs-agentic/openai": minor
---

Add structured output: constrain an agent's final answer to a JSON Schema, with validation and bounded repair.

- `outputSchema` (JSON Schema) on `AgentConfig` and `RunInput`, with optional `structuredOutput` options: `name`, `description`, `strict` (default `false`), `maxRepairAttempts` (default `2`), and a pluggable `validate` for Ajv, zod, or any validator.
- The built-in runtime sends the schema as the new optional `ModelRequest.outputFormat`. Adapters that set `supportsStructuredOutput` forward it natively; for others the schema is described in that request's system prompt only. Existing adapters keep working unchanged.
- The final answer is parsed (tolerating code fences and surrounding prose), validated, and repaired by re-prompting with the specific issues. The parsed value is returned as `AgentResult.structured`, and `runner.run<T>()` types it. A turn that never conforms fails with `StructuredOutputError`. Repair rounds count toward usage and budgets and stay out of session history.
- Streaming emits `output_rejected` before each repair round and `structured` on `final_answer`.
- A dependency-free `validateJsonSchema` covering the subset providers' structured-output modes use, plus `parseJsonAnswer`.
- A turn that would run through a `RuntimeAdapter` with an `outputSchema` throws `StructuredOutputNotSupportedError` instead of returning unvalidated text.
- A run that sets its own `outputSchema` does not inherit the agent's options (its `validate` in particular). Schemas with an invalid pattern or an unresolvable `$ref` throw `InvalidOutputSchemaError` before any model call. A refusal (`ModelResponse.refusal`) fails the turn without repair. A failed turn's conversation is still saved, and an approval whose resumed answer misses its schema is recorded as settled. The schema and repair state survive approval resume and checkpoint recovery.
- The validator also covers `patternProperties`, OpenAPI `nullable`, draft-07 tuples, code-point string lengths, patterns that need the non-Unicode regex mode, and deep recursive `$ref`s.
- `OpenAiModelAdapter` sends `outputFormat` as `response_format: { type: 'json_schema' }` (non-object roots wrapped as `{ value }`), reports refusals, and takes `structuredOutput: 'prompt'` for servers without `json_schema` support.
