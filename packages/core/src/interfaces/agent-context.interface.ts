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
 *
 * Provides identity metadata, conversation session namespacing, distributed tracing,
 * and cooperative cancellation/deadline lifecycle handles.
 *
 * @example
 * ```ts
 * @Tool({ description: 'Fetch remote resource with cancellation support' })
 * async fetchExternalData(@Context() ctx: AgentContext, url: string) {
 *   // Pass cancellation signal directly to native fetch or HTTP clients
 *   const response = await fetch(url, { signal: ctx.signal });
 *   return response.json();
 * }
 * ```
 */
export interface AgentContext {
  /** Security and identity information for the current request. */
  security: AgentSecurityContext;

  /** Session identifier used for conversation memory namespacing. */
  sessionId: string;

  /** Distributed trace identifier (e.g. OpenTelemetry, Langfuse, Jaeger). */
  traceId: string;

  /** Trace identifier of the parent agent invocation when executed as a sub-agent or delegated task. */
  parentTraceId?: string;

  /** Root trace identifier of the topmost agent turn across all sub-agent and nested tool delegations. */
  rootTraceId?: string;

  /** Arbitrary key-value bag for passing custom data into tool handlers. */
  data?: Record<string, unknown>;

  /**
   * Cancellation signal linked to the caller's request and turn timeout scope.
   *
   * Tool handlers performing async I/O (e.g. database queries, HTTP requests, sub-agent runs)
   * should pass this signal to their downstream clients for immediate cooperative cancellation.
   */
  signal?: AbortSignal;

  /**
   * Absolute deadline timestamp after which the current execution turn will time out.
   *
   * Allows long-running tool operations to budget their remaining execution time:
   * `const remainingMs = ctx.deadline ? ctx.deadline.getTime() - Date.now() : undefined;`
   */
  deadline?: Date;
}
