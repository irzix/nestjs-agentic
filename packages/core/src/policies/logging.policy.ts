import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';

/**
 * Options for configuring the logging policy.
 */
export interface LoggingPolicyOptions {
  /** Log level to use for tool execution logs. Default: `'log'` */
  logLevel?: 'log' | 'debug' | 'verbose' | 'warn';

  /** Whether to include tool arguments in the log output. Default: `true` */
  includeArgs?: boolean;

  /** Whether to include context metadata (userId, tenantId) in the log output. Default: `true` */
  includeContext?: boolean;

  /** List of argument field names to mask in logs (e.g., 'password', 'apiKey'). Default: `[]` */
  sensitiveFields?: string[];

  /** Custom logger function. If not provided, logs to console. */
  logger?: (message: string, data: Record<string, unknown>) => void;
}

/**
 * Built-in logging policy for observability and audit trail of tool executions.
 * This policy always returns `allow` and logs tool call details for monitoring purposes.
 *
 * @example
 * ```typescript
 * @UsePolicies(new LoggingPolicy({ 
 *   logLevel: 'debug', 
 *   sensitiveFields: ['password', 'apiKey'] 
 * }))
 * ```
 */
export class LoggingPolicy implements ToolPolicy {
  private readonly logLevel: 'log' | 'debug' | 'verbose' | 'warn';
  private readonly includeArgs: boolean;
  private readonly includeContext: boolean;
  private readonly sensitiveFields: Set<string>;
  private readonly logger: (message: string, data: Record<string, unknown>) => void;

  /**
   * Creates a new instance of LoggingPolicy.
   * @param options Configuration options.
   */
  constructor(options?: LoggingPolicyOptions) {
    this.logLevel = options?.logLevel ?? 'log';
    this.includeArgs = options?.includeArgs ?? true;
    this.includeContext = options?.includeContext ?? true;
    this.sensitiveFields = new Set(options?.sensitiveFields ?? []);
    this.logger = options?.logger ?? this.defaultLogger.bind(this);
  }

  /**
   * Evaluates the tool call and logs execution details.
   * Always returns `allow` as this is a non-blocking observability policy.
   */
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const logData: Record<string, unknown> = {
      type: 'tool_execution',
      toolName,
      sessionId: ctx.sessionId,
      traceId: ctx.traceId,
      timestamp: new Date().toISOString(),
    };

    if (this.includeContext) {
      logData.userId = ctx.security.userId;
      logData.tenantId = ctx.security.tenantId;
      logData.roles = ctx.security.roles;
    }

    if (this.includeArgs && args) {
      logData.args = this.sanitizeArgs(args);
    }

    const message = `[Tool Execution] ${toolName}`;
    this.logger(message, logData);

    return { decision: 'allow' };
  }

  /**
   * Sanitizes arguments by masking sensitive fields.
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    if (this.sensitiveFields.size === 0) {
      return args;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (this.sensitiveFields.has(key)) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeArgs(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Default logger implementation using console methods.
   */
  private defaultLogger(message: string, data: Record<string, unknown>): void {
    const logMethod = this.logLevel === 'warn' ? console.warn : console.log;
    
    // Use appropriate console method based on log level
    switch (this.logLevel) {
      case 'debug':
        if (typeof console.debug === 'function') {
          console.debug(message, data);
        } else {
          console.log(message, data);
        }
        break;
      case 'verbose':
        // Verbose falls back to log since console doesn't have verbose
        console.log(message, data);
        break;
      case 'warn':
        console.warn(message, data);
        break;
      default:
        console.log(message, data);
    }
  }
}
