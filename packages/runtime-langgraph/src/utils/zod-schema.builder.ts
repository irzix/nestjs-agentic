import { z } from 'zod';
import type { ToolParamSchema } from '@nestjs-agentic/core';

/**
 * Builds a dynamic Zod schema object from an array of ToolParamSchema definitions.
 */
export function buildZodSchema(params: ToolParamSchema[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of params) {
    let schema: z.ZodTypeAny;

    switch (param.type) {
      case 'number':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        schema = z.array(z.unknown());
        break;
      case 'object':
        schema = z.record(z.unknown());
        break;
      case 'string':
      default:
        schema = z.string();
        break;
    }

    if (param.description) {
      schema = schema.describe(param.description);
    }

    if (!param.required) {
      schema = schema.optional();
    }

    shape[param.name] = schema;
  }

  return z.object(shape);
}
