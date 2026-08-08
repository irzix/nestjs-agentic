export interface AgentSecurityContext {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  permissions?: string[];
}

export interface AgentContext {
  /** Security and identity information for the current request. */
  security: AgentSecurityContext;

  /** Session identifier used for conversation memory. */
  sessionId: string;

  /** Trace identifier for distributed tracing (e.g. Langfuse, Jaeger). */
  traceId: string;

  /** Arbitrary key-value bag for passing custom data into tool handlers. */
  data?: Record<string, unknown>;
}
