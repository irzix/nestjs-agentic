import type { ToolParamSchema } from '@nestjs-agentic/core';
import { McpValidationError } from '../errors/mcp.errors';
import type { ToolInputSchema } from '../interfaces/mcp.interface';

/**
 * Converts MCP JSON Schema `inputSchema` to the framework's native `ToolParamSchema[]`.
 */
export function mcpSchemaToToolParams(inputSchema?: ToolInputSchema): ToolParamSchema[] {
  if (!inputSchema || !inputSchema.properties) {
    return [];
  }

  const requiredSet = new Set(inputSchema.required ?? []);
  const params: ToolParamSchema[] = [];

  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    let frameworkType: ToolParamSchema['type'] = 'string';

    const rawType = prop.type ?? 'string';
    if (rawType === 'number' || rawType === 'integer') {
      frameworkType = 'number';
    } else if (rawType === 'boolean') {
      frameworkType = 'boolean';
    } else if (rawType === 'object') {
      frameworkType = 'object';
    } else if (rawType === 'array') {
      frameworkType = 'array';
    } else {
      frameworkType = 'string';
    }

    params.push({
      name,
      description: prop.description,
      type: frameworkType,
      required: requiredSet.has(name),
    });
  }

  return params;
}

/**
 * Enforces Gorilla (UC Berkeley) deterministic parameter pre-validation before RPC dispatch.
 * Checks required fields, type conformance, and array/object boundaries to eliminate parameter hallucinations.
 *
 * @throws {McpValidationError} if any argument fails schema type validation.
 */
export function validateGorillaPreConditions(
  serverName: string,
  toolName: string,
  schema: ToolInputSchema | undefined,
  args: Record<string, unknown>,
): void {
  if (!schema || !schema.properties) {
    return;
  }

  const requiredProps = schema.required ?? [];
  for (const req of requiredProps) {
    if (args[req] === undefined || args[req] === null) {
      throw new McpValidationError(
        serverName,
        toolName,
        req,
        'defined (required parameter missing)',
        args[req],
      );
    }
  }

  for (const [paramName, prop] of Object.entries(schema.properties)) {
    const value = args[paramName];
    if (value === undefined || value === null) {
      continue;
    }

    const expectedType = prop.type ?? 'string';
    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          throw new McpValidationError(serverName, toolName, paramName, 'string', value);
        }
        break;
      case 'number':
      case 'integer':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new McpValidationError(serverName, toolName, paramName, 'number', value);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new McpValidationError(serverName, toolName, paramName, 'boolean', value);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          throw new McpValidationError(serverName, toolName, paramName, 'array', value);
        }
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new McpValidationError(serverName, toolName, paramName, 'object', value);
        }
        break;
    }
  }
}

/**
 * Sanitizes subprocess error and stderr streams to redact sensitive credential leaks (OWASP LLM02).
 */
export function sanitizeStderr(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|key|api_key|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:token|apiKey|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2');
}
