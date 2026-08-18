/**
 * Base error class for all Model Context Protocol (MCP) exceptions.
 */
export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when connecting to an MCP server fails or when an active transport disconnects unexpectedly.
 */
export class McpConnectionError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly reason: string,
    public readonly cause?: unknown,
  ) {
    super(`Failed to connect to MCP server "${serverName}": ${reason}`);
  }
}

/**
 * Thrown when an MCP JSON-RPC request exceeds its configured timeout budget.
 */
export class McpTimeoutError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `MCP request "${method}" to server "${serverName}" timed out after ${timeoutMs}ms.`,
    );
  }
}

/**
 * Thrown when an MCP server returns a JSON-RPC protocol error or unexpected message frame.
 */
export class McpProtocolError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly code: number,
    public readonly rpcMessage: string,
    public readonly data?: unknown,
  ) {
    super(
      `MCP server "${serverName}" returned protocol error ${code}: ${rpcMessage}`,
    );
  }
}

/**
 * Thrown when a remote MCP tool execution fails on the server side (`isError: true`).
 */
export class McpToolExecutionError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
    public readonly errorDetail: string,
  ) {
    super(
      `Execution of MCP tool "${toolName}" on server "${serverName}" failed: ${errorDetail}`,
    );
  }
}

/**
 * Thrown when arguments fail deterministic pre-validation against the tool's JSON Schema.
 * Based on Gorilla (UC Berkeley) parameter validation principles.
 */
export class McpValidationError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
    public readonly paramName: string,
    public readonly expectedType: string,
    public readonly actualValue: unknown,
  ) {
    super(
      `Validation error for MCP tool "${toolName}" on server "${serverName}": ` +
        `Parameter "${paramName}" expects ${expectedType}, received ${typeof actualValue} (${JSON.stringify(actualValue)}).`,
    );
  }
}

/**
 * Thrown when attempting to invoke an MCP tool that is not registered or discovered on the server.
 */
export class McpToolNotFoundError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
  ) {
    super(
      `Tool "${toolName}" was not found on MCP server "${serverName}".`,
    );
  }
}

/**
 * Thrown when an in-flight MCP request is cancelled via AbortSignal.
 */
export class McpCancelledError extends McpError {
  constructor(
    public readonly serverName: string,
    public readonly method: string,
  ) {
    super(`MCP request "${method}" to server "${serverName}" was cancelled.`);
  }
}
