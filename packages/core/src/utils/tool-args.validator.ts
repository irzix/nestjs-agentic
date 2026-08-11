import type { ToolParamSchema } from '../interfaces/tool.interface';

export interface ToolArgsValidationResult {
  valid: boolean;
  /** Arguments narrowed to declared parameters, with safe coercions applied. */
  args: Record<string, unknown>;
  issues: string[];
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function coerce(
  param: ToolParamSchema,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; issue: string } {
  const expected = param.type;

  switch (expected) {
    case 'string':
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) };
      }
      break;

    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, value };
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return { ok: true, value: parsed };
      }
      break;

    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true') return { ok: true, value: true };
      if (value === 'false') return { ok: true, value: false };
      break;

    case 'array':
      if (Array.isArray(value)) return { ok: true, value };
      break;

    case 'object':
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return { ok: true, value };
      }
      break;
  }

  return {
    ok: false,
    issue: `parameter "${param.name}" expected ${expected} but received ${describeType(value)}`,
  };
}

/**
 * Validates model-supplied arguments against a tool's declared parameters.
 *
 * Undeclared keys are dropped so hallucinated fields never reach application
 * methods, and missing required parameters are reported instead of silently
 * invoking a tool with incomplete input.
 */
export function validateToolArgs(
  parameters: ToolParamSchema[],
  rawArgs: Record<string, unknown> | undefined,
): ToolArgsValidationResult {
  const provided = rawArgs ?? {};
  const args: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const param of parameters) {
    const hasValue =
      Object.prototype.hasOwnProperty.call(provided, param.name) &&
      provided[param.name] !== undefined &&
      provided[param.name] !== null;

    if (!hasValue) {
      if (param.required) {
        issues.push(`missing required parameter "${param.name}"`);
      }
      continue;
    }

    const result = coerce(param, provided[param.name]);
    if (result.ok) {
      args[param.name] = result.value;
    } else {
      issues.push(result.issue);
    }
  }

  return { valid: issues.length === 0, args, issues };
}
