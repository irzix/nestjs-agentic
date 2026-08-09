/**
 * Injection token for the RuntimeAdapter implementation.
 * @example { provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter }
 */
export const RUNTIME_ADAPTER = Symbol('RUNTIME_ADAPTER');

/**
 * Injection token for the ApprovalStore implementation.
 * Defaults to InMemoryApprovalStore when not explicitly provided.
 * @example { provide: APPROVAL_STORE, useClass: RedisApprovalStore }
 */
export const APPROVAL_STORE = Symbol('APPROVAL_STORE');

/**
 * Injection token for the SessionStore implementation.
 * Defaults to InMemorySessionStore when not explicitly provided.
 * @example { provide: SESSION_STORE, useClass: RedisSessionStore }
 */
export const SESSION_STORE = Symbol('SESSION_STORE');

/**
 * Injection token for registering AgentObserver instances.
 * Accepts a multi-provider array.
 * @example { provide: AGENT_OBSERVERS, useClass: LangfuseObserver, multi: true }
 */
export const AGENT_OBSERVERS = Symbol('AGENT_OBSERVERS');

/**
 * Multi-provider token for all registered ToolPolicy instances.
 * Populated automatically by AgenticModule.forFeature() for each policy
 * listed in the `policies` array. LocalToolProvider uses this to build
 * its policy lookup map without needing ModuleRef.
 * @internal
 */
export const POLICY_INSTANCES = Symbol('POLICY_INSTANCES');

/**
 * Metadata key used by @ToolSet decorator.
 * @internal
 */
export const TOOLSET_METADATA = Symbol('TOOLSET_METADATA');

/**
 * Metadata key used by @Tool decorator.
 * @internal
 */
export const TOOL_METADATA = Symbol('TOOL_METADATA');

/**
 * Metadata key used by @Param decorator.
 * @internal
 */
export const TOOL_PARAMS_METADATA = Symbol('TOOL_PARAMS_METADATA');

/**
 * Metadata key used by @UsePolicies decorator.
 * @internal
 */
export const TOOL_POLICIES_METADATA = Symbol('TOOL_POLICIES_METADATA');

/**
 * Metadata key used by @Agent decorator.
 * @internal
 */
export const AGENT_METADATA = Symbol('AGENT_METADATA');
