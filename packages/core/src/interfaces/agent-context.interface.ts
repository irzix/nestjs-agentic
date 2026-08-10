/**
 * Security and identity context metadata captured for policy evaluation and multi-tenant isolation.
 */
export interface AgentSecurityContext {
  /** User identifier of the requesting user. */
  userId?: string;

  /** Tenant identifier for multi-tenant data isolation. */
  tenantId?: string;

  /** User roles for policy authorization evaluations. */
  roles?: string[];

  /** Permission scopes granted to the user. */
  permissions?: string[];
}

/**
 * Execution context injected into tool closures decorated with `@Context()`.
 */
export interface AgentContext {
  /** Security and identity information for the current request. */
  security: AgentSecurityContext;

  /** Session identifier used for conversation memory namespacing. */
  sessionId: string;

  /** Distributed trace identifier (e.g. OpenTelemetry, Langfuse, Jaeger). */
  traceId: string;

  /** Arbitrary key-value bag for passing custom data into tool handlers. */
  data?: Record<string, unknown>;
}
