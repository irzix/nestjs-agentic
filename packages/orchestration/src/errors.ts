/**
 * Base error class for orchestration exceptions.
 */
export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when sub-agent delegation exceeds the maximum allowed recursion depth.
 */
export class MaxDelegationDepthExceededError extends OrchestrationError {
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number,
    public readonly agentName: string,
  ) {
    super(
      `Max delegation depth exceeded: Delegation to sub-agent "${agentName}" reached depth ${currentDepth} ` +
        `(max allowed: ${maxDepth}).`,
    );
  }
}

/**
 * Thrown when a sub-agent attempts to execute a tool outside its delegated capability whitelist
 * or inside its prohibited blacklist.
 */
export class CapabilityDeniedError extends OrchestrationError {
  constructor(
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`Capability denied for tool "${toolName}": ${reason}`);
  }
}

/**
 * Thrown when a delegated task attempts to request permissions or roles that the parent context does not hold.
 */
export class CapabilityEscalationError extends OrchestrationError {
  constructor(
    public readonly requestedCapabilities: string[],
    public readonly parentCapabilities: string[],
    public readonly type: 'permissions' | 'roles',
  ) {
    super(
      `Capability escalation forbidden: Sub-agent requested ${type} [${requestedCapabilities.join(', ')}] ` +
        `which are not held by parent context [${parentCapabilities.join(', ')}].`,
    );
  }
}
