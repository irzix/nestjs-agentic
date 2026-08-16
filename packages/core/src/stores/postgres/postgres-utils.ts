/**
 * Validates that a table or column name contains only safe SQL identifier characters
 * (alphanumeric and underscore, not starting with a digit) to prevent SQL injection.
 */
export function validateSqlIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid SQL identifier: "${name}". Identifier must contain only alphanumeric characters and underscores.`,
    );
  }
  return name;
}

/**
 * Safely deserializes a JSON or JSONB database value into a deep-cloned object.
 */
export function safeDeserialize<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return JSON.parse(JSON.stringify(raw)) as T;
}
